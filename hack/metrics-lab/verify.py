#!/usr/bin/env python3
"""Read-only checks against real Kubernetes objects and kubelet/KSM scrape samples.

Allow at least two minutes after rollout for the rate window to fill. No fixture
metrics endpoint exists: provenance checks bind samples to live scrape targets.
"""
import argparse
import json
import math
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

NAMESPACE = 'metrics-workloads'
LABEL = 'app.kubernetes.io/part-of=omniview-metrics-lab'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--context', default='kind-kind', choices=['kind-kind'])
    parser.add_argument('--kubeconfig', help='Optional private kubeconfig; never changes current context')
    parser.add_argument('--prometheusURL', '--prometheus-url', dest='prometheus',
                        default='http://127.0.0.1:48572')
    parser.add_argument('--timeout', type=float, default=15, help='Per-request timeout in seconds (1–60)')
    args = parser.parse_args()
    require(1 <= args.timeout <= 60, 'timeout must be between 1 and 60 seconds')
    url = urllib.parse.urlsplit(args.prometheus)
    require(url.scheme == 'http' and url.hostname == '127.0.0.1' and
            not url.username and not url.password and not url.query and not url.fragment,
            'Prometheus URL must be plain HTTP on 127.0.0.1 without credentials/query/fragment')
    base = args.prometheus.rstrip('/')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def kubectl(*arguments):
        command = ['kubectl', '--context', args.context, f'--request-timeout={args.timeout}s']
        if args.kubeconfig:
            command += ['--kubeconfig', args.kubeconfig]
        # Never echo command, stderr, kubeconfig contents, or authentication data.
        result = subprocess.run(command + list(arguments) + ['-o', 'json'],
                                capture_output=True, text=True, timeout=args.timeout + 2)
        require(result.returncode == 0, 'Read-only kubectl request failed; inspect cluster access separately')
        return json.loads(result.stdout)

    def api(path, parameters=None):
        endpoint = base + '/api/v1/' + path
        if parameters:
            endpoint += '?' + urllib.parse.urlencode(parameters)
        with opener.open(endpoint, timeout=args.timeout) as response:
            data = json.load(response)
        require(data.get('status') == 'success', 'Prometheus API request did not succeed')
        return data['data']

    nodes = kubectl('get', 'nodes')['items']
    require(nodes, 'No actual Nodes found')
    require(all(any(c['type'] == 'Ready' and c['status'] == 'True'
                    for c in n.get('status', {}).get('conditions', [])) for n in nodes),
            'Every actual Node must be Ready')
    pods = kubectl('get', 'pods', '-n', NAMESPACE, '-l', LABEL)['items']
    require(len(pods) == 2, 'Expected exactly two fixture Pods; wait for rollout to finish')
    require({p['metadata']['labels'].get('app') for p in pods} == {'metrics-cpu', 'metrics-io'},
            'Unexpected fixture Pod identity')
    expected = {}
    for pod in pods:
        name = pod['metadata']['name']
        status = pod.get('status', {})
        require(status.get('phase') == 'Running' and
                any(c['type'] == 'Ready' and c['status'] == 'True' for c in status.get('conditions', [])),
                f'{name} must be Running and Ready')
        containers = pod['spec']['containers']
        require(len(containers) == 1 and containers[0]['name'] == 'workload' and
                containers[0]['image'] == 'python:3.12.8-alpine3.21' and
                containers[0].get('command') == ['python', '-B', '/app/workload.py'],
                f'{name}: expected actual Python application, not an exporter')
        states = status.get('containerStatuses', [])
        require(len(states) == 1 and states[0].get('ready') and 'running' in states[0].get('state', {}),
                f'{name}: workload container must be Ready and running')
        profile = pod['metadata']['labels']['app']
        expected[name] = {'cpu_request': 0.1 if profile == 'metrics-cpu' else 0.05,
                          'cpu_limit': 0.25 if profile == 'metrics-cpu' else 0.15,
                          'memory_request': (64 if profile == 'metrics-cpu' else 96) * 2**20,
                          'memory_limit': (128 if profile == 'metrics-cpu' else 192) * 2**20,
                          'restarts': states[0]['restartCount']}
    source = kubectl('get', 'configmap', 'metrics-workload-source', '-n', NAMESPACE)
    require(set(source.get('data', {})) == {'workload.py'} and
            source['data']['workload.py'].startswith('"""Bounded real application work;'),
            'Expected fixture application source ConfigMap, not a metrics exporter')

    # Each family query covers the complete resource set, never one request per Pod.
    names = '|'.join(re.escape(name) for name in sorted(expected))
    pod_matcher = json.dumps('^(?:' + names + ')$')
    identity = f'cluster="kind-kind",namespace="{NAMESPACE}",pod=~{pod_matcher}'
    cadvisor = identity + ',job=~".*kubelet.*",metrics_path="/metrics/cadvisor"'
    ksm = identity + ',job=~".*kube-state-metrics.*",container="workload"'
    targets = api('targets', {'state': 'active'})['activeTargets']
    healthy = [target for target in targets if target.get('health') == 'up']

    def samples(expression, provenance):
        data = api('query', {'query': expression})
        require(data.get('resultType') == 'vector', 'Expected genuine instant-vector response')
        result = data['result']
        values = {}
        for sample in result:
            labels = sample['metric']
            pod = labels.get('pod')
            require(labels.get('cluster') == 'kind-kind' and labels.get('namespace') == NAMESPACE
                    and pod in expected, 'Sample identity escaped requested cluster/namespace/Pod set')
            timestamp, raw = sample['value']
            value = float(raw)
            require(math.isfinite(value) and value >= 0 and abs(time.time() - float(timestamp)) < 180,
                    'Invalid or stale sample value')
            matching = [t for t in healthy if
                        t.get('labels', {}).get('job') == labels.get('job') and
                        t.get('labels', {}).get('instance') == labels.get('instance') and
                        t.get('labels', {}).get('cluster') == 'kind-kind']
            if provenance == 'cadvisor':
                require(any(urllib.parse.urlsplit(t.get('scrapeUrl', '')).path == '/metrics/cadvisor'
                            and any(t.get('discoveredLabels', {}).get(key)
                                    in {n['metadata']['name'] for n in nodes}
                                    for key in ('__meta_kubernetes_node_name',
                                                '__meta_kubernetes_endpoint_node_name',
                                                '__meta_kubernetes_endpointslice_endpoint_node_name',
                                                '__meta_kubernetes_endpoint_address_target_name'))
                            for t in matching),
                        'cAdvisor sample lacks a healthy actual Kubernetes node scrape target')
            else:
                require(any(t.get('discoveredLabels', {}).get('__meta_kubernetes_namespace') == 'observability'
                            and 'kube-state-metrics' in t.get('discoveredLabels', {}).get(
                                '__meta_kubernetes_pod_name', '') for t in matching),
                        'KSM sample lacks a healthy observability kube-state-metrics Pod target')
            # Multiple exporters/duplicate scrape jobs must not inflate observations.
            require(pod not in values, f'Duplicate samples for {pod}; remove duplicate scrape targets')
            values[pod] = value
        return values

    def check(family, expression, provenance, bound, optional=False):
        values = samples(expression, provenance)
        if optional and not values:
            print(f'OPTIONAL UNAVAILABLE {family}')
            return
        require(set(values) == set(expected), f'{family}: missing actual samples for some fixture Pods')
        for pod, value in values.items():
            require(bound(pod, value), f'{family}: {pod} value {value:g} outside expected rough bounds')
        print(f'PASS {family}: ' + ', '.join(f'{p}={v:.6g}' for p, v in sorted(values.items())))

    container = cadvisor + ',container="workload",image!=""'
    check('CPU cores', f'rate(container_cpu_usage_seconds_total{{{container}}}[2m])', 'cadvisor',
          lambda p, v: 0.0001 < v < expected[p]['cpu_limit'] * 1.5)
    check('memory working set bytes', f'container_memory_working_set_bytes{{{container}}}', 'cadvisor',
          lambda p, v: 16 * 2**20 < v <= expected[p]['memory_limit'])
    # Pod network counters belong to the sandbox, not the workload container.
    for direction in ('receive', 'transmit'):
        check(f'network {direction} bytes/sec',
              f'rate(container_network_{direction}_bytes_total{{{cadvisor},interface="eth0"}}[2m])',
              'cadvisor', lambda p, v: 100 < v < 10 * 2**20)
    for category in ('requests', 'limits'):
        for resource, unit in (('cpu', 'core'), ('memory', 'byte')):
            key = resource + ('_request' if category == 'requests' else '_limit')
            check(f'KSM {resource} {category}',
                  f'kube_pod_container_resource_{category}{{{ksm},resource="{resource}",unit="{unit}"}}',
                  'ksm', lambda p, v, key=key: math.isclose(v, expected[p][key], rel_tol=0.001))
    check('KSM restarts', f'kube_pod_container_status_restarts_total{{{ksm}}}', 'ksm',
          lambda p, v: v == expected[p]['restarts'])
    fs_rate = f'rate(container_fs_writes_bytes_total{{{container}}}[2m])'
    check('filesystem writes bytes/sec',
          f'sum by (cluster, namespace, pod, job, instance) ({fs_rate})',
          'cadvisor', lambda p, v: 0 <= v < 100 * 2**20, optional=True)
    check('CPU throttled seconds/sec', f'rate(container_cpu_cfs_throttled_seconds_total{{{container}}}[2m])',
          'cadvisor', lambda p, v: 0 <= v < 10, optional=True)
    print('PASS: actual Ready Nodes, two Ready Running application Pods, kubelet cAdvisor and KSM provenance')
    print('Filesystem counters may be absent or zero on overlayfs; file writes remain real application behavior.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError,
            urllib.error.URLError) as error:
        # Do not print backend errors or URLs: either can contain authentication data.
        message = (str(error) if type(error) is ValueError else
                   f'Prometheus HTTP {error.code}' if isinstance(error, urllib.error.HTTPError) else
                   type(error).__name__)
        print('FAIL: ' + message, file=sys.stderr)
        sys.exit(1)
