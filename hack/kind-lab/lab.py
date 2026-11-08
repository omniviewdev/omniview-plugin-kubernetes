#!/usr/bin/env python3
"""Real local Kubernetes inventory and bounded watch traffic. Python standard library only."""
import argparse
import base64
import json
import pathlib
import re
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_NAME = 'omniview-load-lab'
STATE = ROOT / '.state'
# One lowercase DNS label of at most 40 characters, so '<name>-control-plane' fits a 63-character hostname.
NAME_PATTERN = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?')
# (namespaces, applications per namespace); each application is one Deployment with one Pod.
PRESETS = {'smoke': (2, 2), 'baseline': (10, 30), 'medium': (20, 30), 'large': (20, 50), 'xl': (40, 50)}
# Leaves room below the usual 110-Pod kubelet limit for system Pods and rollouts.
PODS_PER_WORKER = 100
# Everything this driver writes into a named cluster's state directory.
STATE_FILES = ('kubeconfig', 'kubeconfig.lock', 'kind.json', 'owner.json')


def cluster_name(value):
    """argparse type for --name; state_dir applies the same pattern to every derived path."""
    if not NAME_PATTERN.fullmatch(value):
        raise argparse.ArgumentTypeError(
            f'{value!r} is not a valid cluster name; use 1-40 lowercase letters, digits or hyphens, '
            'beginning and ending with a letter or digit')
    return value


def state_dir(name):
    """The default lab keeps its original flat .state; a named lab never shares it."""
    if not NAME_PATTERN.fullmatch(name):
        raise ValueError(f'invalid cluster name {name!r}')
    return STATE if name == DEFAULT_NAME else STATE / 'clusters' / name


def kubeconfig_path(name):
    return state_dir(name) / 'kubeconfig'


def run(args, data=None, capture=False, timeout=360):
    try:
        return subprocess.run(args, input=None if data is None else json.dumps(data),
                              text=True, check=True, capture_output=capture, timeout=timeout).stdout
    except subprocess.TimeoutExpired:
        raise SystemExit(f'{args[0]} timed out after {timeout}s; inspect cluster state before retrying') from None


def kubectl(cluster, *args, data=None, capture=False):
    kube = kubeconfig_path(cluster)
    if not kube.is_file():
        raise SystemExit(f'private kubeconfig {kube} is absent; this driver uses no other kubeconfig. '
                         'Create the lab here, or recover only a cluster you created (see README)')
    return run(['kubectl', '--kubeconfig', str(kube), '--context', 'kind-' + cluster,
                '--request-timeout=60s', *args], data, capture)


def obj(cluster, kind, name, namespace=None, **fields):
    metadata = {'name': name, 'labels': {'app.kubernetes.io/part-of': cluster}}
    if namespace:
        metadata['namespace'] = namespace
    return {'apiVersion': 'apps/v1' if kind == 'Deployment' else 'v1',
            'kind': kind, 'metadata': metadata, **fields}


def pod_count(preset):
    namespaces, per_namespace = PRESETS[preset]
    return namespaces * per_namespace


def inventory(preset, cluster):
    namespaces, per_namespace = PRESETS[preset]
    for n in range(namespaces):
        ns = f'load-{n:03}'
        yield obj(cluster, 'Namespace', ns)
        for i in range(per_namespace):
            name = f'app-{i:03}'
            selector = {'app': name}
            yield obj(cluster, 'ConfigMap', name, ns, data={'payload': 'x' * 2048})
            yield obj(cluster, 'Secret', name, ns, type='Opaque',
                      data={'synthetic': base64.b64encode(b'x' * 1024).decode()})
            yield obj(cluster, 'Service', name, ns, spec={'selector': selector,
                      'ports': [{'port': 80, 'targetPort': 8080}]})
            for event_index in range(3):
                yield obj(cluster, 'Event', f'{name}-seed-{event_index}', ns,
                          involvedObject={'apiVersion': 'v1', 'kind': 'ConfigMap', 'namespace': ns, 'name': name},
                          reason='SyntheticSeed', message='Synthetic inventory event',
                          type='Normal', source={'component': cluster}, count=1,
                          lastTimestamp=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
            yield obj(cluster, 'Deployment', name, ns, spec={
                'replicas': 1, 'revisionHistoryLimit': 1,
                'selector': {'matchLabels': selector},
                'template': {'metadata': {'labels': {'app.kubernetes.io/part-of': cluster, **selector}}, 'spec': {
                    'terminationGracePeriodSeconds': 2,
                    'containers': [{'name': 'http', 'image': 'busybox:1.37.0@sha256:a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec',
                        'command': ['sh', '-c', 'mkdir -p /tmp/www; echo load-lab > /tmp/www/index.html; exec httpd -f -p 8080 -h /tmp/www'],
                        'ports': [{'containerPort': 8080}],
                        'resources': {'requests': {'cpu': '1m', 'memory': '4Mi'},
                                      'limits': {'cpu': '50m', 'memory': '16Mi'}},
                        'readinessProbe': {'tcpSocket': {'port': 8080}, 'periodSeconds': 30}}]}}})


def apply(cluster, items):
    kubectl(cluster, 'apply', '-f', '-', data={'apiVersion': 'v1', 'kind': 'List', 'items': items})


def cluster_exists(cluster):
    return cluster in run(['kind', 'get', 'clusters'], capture=True, timeout=60).split()


def require_owned(cluster):
    """A named lab mutates or deletes only clusters this checkout created; the default lab predates receipts."""
    if cluster == DEFAULT_NAME:
        return
    receipt = state_dir(cluster) / 'owner.json'
    try:
        owner = json.loads(receipt.read_text())
    except (OSError, ValueError):
        owner = None
    if not isinstance(owner, dict) or owner.get('name') != cluster:
        raise SystemExit(f'no ownership receipt for {cluster} at {receipt}; this driver mutates and deletes only '
                         'clusters it created with `create --name` (see README)')


def ready_workers(cluster):
    nodes = json.loads(kubectl(cluster, 'get', 'nodes', '-l', '!node-role.kubernetes.io/control-plane',
                               '-o', 'json', capture=True))['items']
    return sum(any(c['type'] == 'Ready' and c['status'] == 'True'
                   for c in node.get('status', {}).get('conditions', [])) for node in nodes)


def require_capacity(cluster, preset):
    needed = -(-pod_count(preset) // PODS_PER_WORKER)
    ready = ready_workers(cluster)
    if ready < needed:
        raise SystemExit(f'preset {preset} has {pod_count(preset)} Pods and needs {needed} Ready workers at '
                         f'{PODS_PER_WORKER} application Pods each; {cluster} has {ready}. '
                         'Nothing was seeded; use a cluster created with more workers')


def forget_state(cluster):
    """Remove only the files this driver wrote for a named cluster, then its directory if nothing else remains."""
    if cluster == DEFAULT_NAME:
        raise ValueError('the default lab state is never removed')
    state = state_dir(cluster)
    for filename in STATE_FILES:
        try:
            (state / filename).unlink()
        except FileNotFoundError:
            pass
    try:
        state.rmdir()
    except OSError:
        print(f'kept {state}: it holds files this driver did not write')


def create_cluster(cluster, workers):
    # Refuse before writing anything: an existing cluster's state and kubeconfig are never replaced.
    if cluster_exists(cluster):
        raise SystemExit(f'cluster {cluster} already exists; create never overwrites its state or kubeconfig')
    named = cluster != DEFAULT_NAME
    state = state_dir(cluster)
    STATE.mkdir(mode=0o700, exist_ok=True)
    if named:
        (STATE / 'clusters').mkdir(mode=0o700, exist_ok=True)
        try:
            state.mkdir(mode=0o700)
        except FileExistsError:
            raise SystemExit(f'state for {cluster} already exists at {state} but kind lists no such cluster; '
                             'inspect it and remove it yourself before creating') from None
    config = {'kind': 'Cluster', 'apiVersion': 'kind.x-k8s.io/v1alpha4',
              'networking': {'apiServerAddress': '127.0.0.1'},
              'kubeadmConfigPatches': ['kind: ClusterConfiguration\napiServer:\n  extraArgs:\n    event-ttl: 1h\n'],
              'nodes': [{'role': 'control-plane'}] + [{'role': 'worker'} for _ in range(workers)]}
    config_path = state / 'kind.json'
    config_path.write_text(json.dumps(config))
    if named:
        # Written before kind runs, so a cluster this driver started always has its ownership receipt.
        (state / 'owner.json').write_text(json.dumps({
            'name': cluster, 'workers': workers, 'created': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}))
    kube = state / 'kubeconfig'
    try:
        run(['kind', 'create', 'cluster', '--name', cluster, '--image',
             'kindest/node:v1.35.0@sha256:4613778f3cfcd10e615029370f5786704559103cf27bef934597ba562b269661',
             '--config', str(config_path), '--kubeconfig', str(kube), '--wait', '180s'], timeout=900)
    except BaseException:
        if named:
            # Drop the state created above only when kind verifiably left no cluster; otherwise keep it to inspect.
            try:
                absent = not cluster_exists(cluster)
            except (SystemExit, OSError, subprocess.CalledProcessError):
                absent = False
            if absent:
                forget_state(cluster)
        raise
    if named and kube.is_file():
        kube.chmod(0o600)
    # Workers join before kind returns but may not be Ready yet; seed counts only Ready workers.
    deadline = time.monotonic() + 180
    while ready_workers(cluster) < workers:
        if time.monotonic() > deadline:
            raise SystemExit(f'{cluster} was created but not all {workers} workers are Ready after 180s; '
                             'inspect its nodes before seeding')
        time.sleep(3)
    print(json.dumps({'created': cluster, 'context': 'kind-' + cluster, 'kubeconfig': str(kube), 'workers': workers}))


def delete_cluster(cluster):
    require_owned(cluster)
    run(['kind', 'delete', 'cluster', '--name', cluster, '--kubeconfig', str(kubeconfig_path(cluster))])
    if cluster != DEFAULT_NAME:
        forget_state(cluster)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['create', 'seed', 'churn', 'status', 'render', 'delete'])
    parser.add_argument('--name', type=cluster_name, default=DEFAULT_NAME,
                        help='kind cluster to target: 1-40 lowercase letters, digits or hyphens. The default '
                             'keeps the original .state files; other names use .state/clusters/<name>')
    parser.add_argument('--preset', choices=PRESETS, default='baseline')
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--interval', type=float, default=1.0, help='seconds per churn cycle; three writes per cycle')
    parser.add_argument('--duration', type=float, default=300, help='churn duration in seconds')
    parser.add_argument('--rollout-every', type=int, default=0, help='roll one deployment every N cycles; 0 disables')
    parser.add_argument('--confirm-delete', action='store_true')
    args = parser.parse_args()
    cluster = args.name
    if args.workers < 1 or args.interval < 0.1 or args.duration <= 0:
        parser.error('workers >= 1, interval >= 0.1, duration > 0 required')
    if args.command == 'render':
        print(json.dumps({'apiVersion': 'v1', 'kind': 'List', 'items': list(inventory(args.preset, cluster))}))
    elif args.command == 'create':
        create_cluster(cluster, args.workers)
    elif args.command == 'seed':
        require_owned(cluster)
        require_capacity(cluster, args.preset)
        # Bound request size and let namespaces exist before their children.
        batch = []
        for item in inventory(args.preset, cluster):
            batch.append(item)
            if len(batch) >= 81:
                apply(cluster, batch)
                batch = []
        if batch:
            apply(cluster, batch)
        for n in range(PRESETS[args.preset][0]):
            kubectl(cluster, 'wait', 'deployment', '--all', '-n', f'load-{n:03}',
                    '--for=condition=Available', '--timeout=300s')
    elif args.command == 'churn':
        require_owned(cluster)
        # Discover actual seeded objects, not assumed preset counts.
        maps = json.loads(kubectl(cluster, 'get', 'configmaps', '-A', '-l',
                                  'app.kubernetes.io/part-of=' + cluster, '-o', 'json', capture=True))['items']
        if not maps:
            parser.error('seed cluster before starting churn')
        end = time.monotonic() + args.duration
        sequence = 0
        rollouts = 0
        while time.monotonic() < end:
            start = time.monotonic()
            target = maps[sequence % len(maps)]['metadata']
            ns, name = target['namespace'], target['name']
            patch = {'data': {'generation': str(sequence)}}
            kubectl(cluster, 'patch', 'configmap', name, '-n', ns, '--type=merge', '-p', json.dumps(patch), capture=True)
            kubectl(cluster, 'patch', 'secret', name, '-n', ns, '--type=merge', '-p',
                    json.dumps({'stringData': {'generation': str(sequence)}}), capture=True)
            if args.rollout_every > 0 and sequence % args.rollout_every == 0:
                kubectl(cluster, 'patch', 'deployment', name, '-n', ns, '--type=merge', '-p',
                        json.dumps({'spec': {'template': {'metadata': {'annotations': {
                            'load-lab/generation': str(time.time_ns())}}}}}), capture=True)
                rollouts += 1
            # A fixed 100-name ring per namespace bounds inventory even during long runs.
            event = obj(cluster, 'Event', f'activity-{sequence % 100:03}', ns,
                        involvedObject={'apiVersion': 'v1', 'kind': 'ConfigMap', 'namespace': ns, 'name': name},
                        reason='SyntheticActivity', message=f'Synthetic update {sequence}',
                        type='Normal', source={'component': cluster}, count=sequence + 1,
                        lastTimestamp=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
            apply(cluster, [event])
            sequence += 1
            time.sleep(max(0, args.interval - (time.monotonic() - start)))
        print(json.dumps({'cycles': sequence, 'writes': sequence * 3 + rollouts, 'rollouts': rollouts}))
    elif args.command == 'status':
        kubectl(cluster, 'get', 'nodes', '-o', 'wide')
        for resource in ['pods', 'deployments', 'services', 'secrets', 'configmaps', 'events']:
            items = json.loads(kubectl(cluster, 'get', resource, '-A', '-l',
                               'app.kubernetes.io/part-of=' + cluster, '-o', 'json', capture=True))['items']
            print(f'{resource}: {len(items)}')
            if resource == 'pods':
                print('ready pods:', sum(any(c['type'] == 'Ready' and c['status'] == 'True'
                      for c in p.get('status', {}).get('conditions', [])) for p in items))
                print('deleting pods:', sum(1 for p in items if p['metadata'].get('deletionTimestamp')))
    elif args.command == 'delete':
        if not args.confirm_delete:
            parser.error('delete requires --confirm-delete; removes only ' + cluster)
        delete_cluster(cluster)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
