#!/usr/bin/env python3
"""Install or verify real metrics-server only in the owned local Kind load lab."""
import argparse
import datetime
import decimal
import json
import pathlib
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
NAME = 'omniview-load-lab'
KUBE = ROOT / '.state' / 'kubeconfig'
CONTEXT = 'kind-' + NAME
VERSION = 'v0.8.0'
MANIFEST = f'https://github.com/kubernetes-sigs/metrics-server/releases/download/{VERSION}/components.yaml'
IMAGE = 'registry.k8s.io/metrics-server/metrics-server:' + VERSION


def run(args, data=None, timeout=60):
    # Never echo command stderr, kubeconfig, environment or HTTP authentication.
    try:
        result = subprocess.run(args, input=data, text=True, capture_output=True,
                                check=False, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError(f'{args[0]} unavailable or timed out') from None
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed (exit {result.returncode}); inspect the local lab separately')
    return result.stdout


def kubectl(*args, data=None, timeout=60):
    return run(['kubectl', '--kubeconfig', str(KUBE), '--context', CONTEXT,
                f'--request-timeout={min(15, timeout)}s', *args], data, timeout)


def require_owned_kind(deadline=None):
    def budget():
        return remaining(deadline) if deadline is not None else 60

    if not KUBE.is_file():
        raise RuntimeError('Create the dedicated lab first; its private kubeconfig is absent')
    clusters = run(['kind', 'get', 'clusters'], timeout=budget()).splitlines()
    if NAME not in clusters:
        raise RuntimeError('Dedicated Kind cluster is absent')
    config = json.loads(kubectl('config', 'view', '--minify', '-o', 'json', timeout=budget()))
    if config.get('current-context') != CONTEXT or len(config.get('clusters', [])) != 1:
        raise RuntimeError('Private kubeconfig does not select the owned lab')
    endpoint = urllib.parse.urlparse(config['clusters'][0]['cluster']['server'])
    if endpoint.scheme != 'https' or endpoint.hostname != '127.0.0.1' or not endpoint.port:
        raise RuntimeError('Owned lab API must use an explicit loopback TLS endpoint')
    nodes = run(['kind', 'get', 'nodes', '--name', NAME], timeout=budget()).splitlines()
    control_plane = NAME + '-control-plane'
    if control_plane not in nodes:
        raise RuntimeError('Owned lab control plane is absent')
    container = json.loads(run(['docker', 'inspect', control_plane], timeout=budget()))[0]
    labels = container.get('Config', {}).get('Labels', {})
    ports = container.get('NetworkSettings', {}).get('Ports', {}).get('6443/tcp') or []
    if labels.get('io.x-k8s.kind.cluster') != NAME or labels.get('io.x-k8s.kind.role') != 'control-plane':
        raise RuntimeError('Control-plane container ownership does not match the lab')
    if not any(p.get('HostIp') == '127.0.0.1' and p.get('HostPort') == str(endpoint.port) for p in ports):
        raise RuntimeError('Private kubeconfig endpoint does not match the owned container port')


def decode_manifest_objects(text):
    """kubectl may emit a JSON object per YAML document, not one enclosing List."""
    decoder = json.JSONDecoder()
    position = 0
    items = []
    while position < len(text):
        while position < len(text) and text[position].isspace():
            position += 1
        if position == len(text):
            break
        value, position = decoder.raw_decode(text, position)
        if not isinstance(value, dict):
            raise RuntimeError('kubectl manifest output must contain Kubernetes objects')
        objects = value.get('items', []) if value.get('kind') == 'List' else [value]
        if not isinstance(objects, list) or any(not isinstance(item, dict) for item in objects):
            raise RuntimeError('kubectl manifest List contains invalid objects')
        items.extend(objects)
    if not items:
        raise RuntimeError('kubectl manifest output is empty')
    return items

def install():
    # Version-pinned upstream release, not a fake exporter or generated samples.
    with urllib.request.urlopen(MANIFEST, timeout=30) as response:
        manifest = response.read((1 << 20) + 1)
    if len(manifest) > 1 << 20:
        raise RuntimeError('Upstream manifest exceeds 1 MiB')
    items = decode_manifest_objects(kubectl('create', '--dry-run=client', '--validate=false',
                                           '-f', '-', '-o', 'json', data=manifest.decode()))
    deployments = [item for item in items if item.get('kind') == 'Deployment']
    if len(deployments) != 1 or deployments[0]['metadata']['name'] != 'metrics-server':
        raise RuntimeError('Unexpected upstream metrics-server manifest')
    containers = deployments[0]['spec']['template']['spec']['containers']
    if len(containers) != 1 or containers[0]['image'] != IMAGE:
        raise RuntimeError('Unexpected upstream metrics-server image')
    # Kind kubelet serving certificates are not externally signed. This exception
    # is restricted to the verified, dedicated local cluster above.
    args = containers[0].setdefault('args', [])
    if '--kubelet-insecure-tls' not in args:
        args.append('--kubelet-insecure-tls')
    kubectl('apply', '-f', '-', data=json.dumps({'apiVersion': 'v1', 'kind': 'List', 'items': items}))
    kubectl('rollout', 'status', 'deployment/metrics-server', '-n', 'kube-system',
            '--timeout=180s', timeout=195)
    kubectl('wait', 'apiservice/v1beta1.metrics.k8s.io', '--for=condition=Available',
            '--timeout=120s', timeout=135)
    print(json.dumps({'installed': VERSION, 'context': CONTEXT, 'kubelet_tls_exception': 'owned local Kind only'}))


def quantity(text):
    match = re.fullmatch(r'([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)([numkKMGTEP]|[KMGTPE]i)?', str(text))
    if not match:
        raise ValueError('Invalid Kubernetes resource quantity')
    powers = {'n': -9, 'u': -6, 'm': -3, 'k': 3, 'K': 3, 'M': 6, 'G': 9, 'T': 12, 'P': 15, 'E': 18}
    suffix = match[2] or ''
    factor = decimal.Decimal(1)
    if suffix.endswith('i'):
        factor = decimal.Decimal(1024) ** ('KMGTPE'.index(suffix[0]) + 1)
    elif suffix:
        factor = decimal.Decimal(10) ** powers[suffix]
    value = decimal.Decimal(match[1]) * factor
    if not value.is_finite() or value < 0:
        raise ValueError('Invalid negative or nonfinite measurement')
    return value


def remaining(deadline):
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise RuntimeError('Verification deadline expired')
    return seconds


def verify_route(get):
    deployment = get('deployment', 'metrics-server', '-n', 'kube-system')
    containers = deployment['spec']['template']['spec']['containers']
    if len(containers) != 1 or containers[0]['image'] != IMAGE:
        raise ValueError('Install the pinned metrics-server version before verification')
    api = get('apiservice', 'v1beta1.metrics.k8s.io')
    service_ref = api['spec']['service']
    if service_ref['namespace'] != 'kube-system' or service_ref['name'] != 'metrics-server':
        raise ValueError('Metrics APIService does not route to the pinned Service')
    if not any(c.get('type') == 'Available' and c.get('status') == 'True'
               for c in api.get('status', {}).get('conditions', [])):
        raise ValueError('Metrics APIService is not Available')
    service = get('service', service_ref['name'], '-n', service_ref['namespace'])
    ports = [p for p in service['spec']['ports'] if p['port'] == service_ref.get('port', 443)]
    if len(ports) != 1 or service['spec'].get('type') == 'ExternalName':
        raise ValueError('Metrics APIService has no unambiguous local Service port')
    endpoints = get('endpoints', service_ref['name'], '-n', service_ref['namespace'])
    serving = []
    for subset in endpoints.get('subsets', []):
        if any(p.get('name', '') == ports[0].get('name', '') for p in subset.get('ports', [])):
            serving.extend(subset.get('addresses', []))
    if not serving:
        raise ValueError('Metrics Service has no serving Pods')
    for address in serving:
        ref = address.get('targetRef', {})
        if ref.get('kind') != 'Pod' or ref.get('namespace') != 'kube-system':
            raise ValueError('Metrics Service endpoint is not a local Pod')
        pod = get('pod', ref['name'], '-n', 'kube-system')
        if ref.get('uid') != pod['metadata']['uid'] or address['ip'] not in {
                p['ip'] for p in pod.get('status', {}).get('podIPs', [])}:
            raise ValueError('Metrics Service endpoint Pod identity does not match')
        owners = [o for o in pod['metadata'].get('ownerReferences', [])
                  if o.get('controller') and o.get('kind') == 'ReplicaSet']
        if len(owners) != 1:
            raise ValueError('Metrics serving Pod has no ReplicaSet controller')
        replica = get('replicaset', owners[0]['name'], '-n', 'kube-system')
        if replica['metadata']['uid'] != owners[0]['uid'] or not any(
                o.get('controller') and o.get('kind') == 'Deployment' and
                o.get('uid') == deployment['metadata']['uid']
                for o in replica['metadata'].get('ownerReferences', [])):
            raise ValueError('Metrics serving Pod is not owned by the pinned Deployment')
        actual = pod['spec']['containers']
        if len(actual) != 1 or actual[0]['image'] != IMAGE:
            raise ValueError('Metrics serving Pod does not use the pinned image')


def require_container_coverage(pod, containers):
    running = {c['name'] for c in pod.get('status', {}).get('containerStatuses', [])
               if 'running' in c.get('state', {})}
    running.update(c['name'] for c in pod.get('status', {}).get('initContainerStatuses', [])
                   if 'running' in c.get('state', {}))
    names = {c['name'] for c in containers}
    if not running or not running.issubset(names):
        raise ValueError('Source measurements do not cover all running containers')


def verify(namespace, timeout):
    deadline = time.monotonic() + timeout
    require_owned_kind(deadline)

    def get(*args):
        value = json.loads(kubectl('get', *args, '-o', 'json', timeout=remaining(deadline)))
        remaining(deadline)
        return value

    last_error = 'No measurements yet'
    while time.monotonic() < deadline:
        try:
            verify_route(get)
            pods = get('pods', '-n', namespace, '-l',
                       'app.kubernetes.io/part-of=' + NAME)['items']
            ready = {p['metadata']['name'] for p in pods if not p['metadata'].get('deletionTimestamp') and
                     any(c.get('type') == 'Ready' and c.get('status') == 'True' for c in p.get('status', {}).get('conditions', []))}
            by_name = {p['metadata']['name']: p for p in pods}
            if len(ready) < 2:
                raise ValueError('Seed at least two real Ready application Pods in this namespace')
            data = json.loads(kubectl('get', '--raw', f'/apis/metrics.k8s.io/v1beta1/namespaces/{namespace}/pods',
                                     timeout=remaining(deadline)))
            remaining(deadline)
            seen = set()
            samples = []
            for item in data['items']:
                metadata = item['metadata']
                if metadata.get('namespace') != namespace or metadata['name'] not in ready:
                    continue
                if metadata['name'] in seen:
                    raise ValueError('Duplicate source Pod identity')
                seen.add(metadata['name'])
                timestamp = datetime.datetime.fromisoformat(item['timestamp'].replace('Z', '+00:00'))
                if timestamp.tzinfo is None:
                    raise ValueError('Source timestamp has no timezone')
                age = (datetime.datetime.now(datetime.timezone.utc) - timestamp).total_seconds()
                if age < -30 or age > 120 or not re.fullmatch(r'(?:[0-9]+(?:\.[0-9]+)?(?:ns|us|µs|ms|s|m|h))+', item['window']) or not re.search(r'[1-9]', item['window']):
                    raise ValueError('Source timestamp/window is stale, absent or invalid')
                containers = item['containers']
                if not containers or len({c['name'] for c in containers}) != len(containers):
                    raise ValueError('Source container identities are absent or duplicate')
                require_container_coverage(by_name[metadata['name']], containers)
                cpu = sum((quantity(c['usage']['cpu']) for c in containers), decimal.Decimal(0))
                memory = sum((quantity(c['usage']['memory']) for c in containers), decimal.Decimal(0))
                if memory <= 0:
                    raise ValueError('Real running Pods must report positive working-set bytes')
                samples.append({'pod': metadata['name'], 'observed_at': item['timestamp'], 'window': item['window'],
                                'cpu_cores': str(cpu), 'working_set_bytes': str(memory),
                                'identity_scope': 'name'})
            if len(samples) < 2:
                raise ValueError('Metrics-server has not measured two Ready lab Pods yet')
            remaining(deadline)
            print(json.dumps({'context': CONTEXT, 'namespace': namespace, 'backend': 'metrics.k8s.io/v1beta1',
                              'objects_scanned': len(data['items']), 'measured_ready_pods': len(samples), 'samples': samples[:4]}))
            return
        except (KeyError, ValueError, RuntimeError) as error:
            last_error = str(error)
            time.sleep(min(3, max(0, deadline - time.monotonic())))
    raise RuntimeError('Native verification did not complete: ' + last_error)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['install', 'verify'])
    parser.add_argument('--confirm-install', action='store_true', help='Explicitly allow installation into the owned lab')
    parser.add_argument('--confirm-owner-permission', action='store_true',
                        help='Attest that you created this disposable cluster or its creator permits cluster-wide RBAC installation')
    parser.add_argument('--namespace', default='load-000')
    parser.add_argument('--timeout', type=int, default=120)
    args = parser.parse_args()
    if not re.fullmatch(r'load-[0-9]{3}', args.namespace) or not 1 <= args.timeout <= 300:
        parser.error('namespace must be load-NNN; timeout must be 1..300 seconds')
    if args.command == 'install' and not args.confirm_install:
        parser.error('install requires --confirm-install; this changes only the dedicated local Kind cluster')
    if args.command == 'install' and not args.confirm_owner_permission:
        parser.error('install requires --confirm-owner-permission; names and Docker labels do not prove ownership')
    if args.command == 'install':
        require_owned_kind()
    if args.command == 'install':
        install()
    else:
        verify(args.namespace, args.timeout)


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        # These messages are authored locally; subprocess stderr is never copied.
        raise SystemExit('Native metrics lab operation failed: ' + str(error)) from None
    except (ValueError, KeyError, OSError, urllib.error.URLError):
        # Avoid a traceback containing remote error bodies, config or credentials.
        raise SystemExit('Native metrics lab received invalid data or could not reach the pinned release') from None
