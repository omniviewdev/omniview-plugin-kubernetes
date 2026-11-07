#!/usr/bin/env python3
"""Install real telemetry into the existing local kind-kind cluster; never create a cluster."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent
STATE = ROOT / '.state'
KUBE = STATE / 'kubeconfig'
RELEASE = 'omniview-metrics'
NAMESPACE = 'observability'
OWNER_KEY = 'app.kubernetes.io/part-of'
OWNER = 'omniview-metrics-lab'
CHART_VERSION = '92.18.0'
CONTEXT = 'kind-kind'


def run(args, capture=False, data=None, timeout=120):
    try:
        return subprocess.run(args, input=data, text=True, check=True,
                              capture_output=capture, timeout=timeout).stdout
    except subprocess.TimeoutExpired:
        raise SystemExit(f'{args[0]} timed out after {timeout}s; inspect state before retrying') from None
    except subprocess.CalledProcessError as error:
        if error.stderr:
            print(error.stderr, end='')
        raise SystemExit(f'{args[0]} failed with status {error.returncode}; inspect state before retrying') from None


def kubectl(*args, capture=False, data=None):
    return run(['kubectl', '--kubeconfig', str(KUBE), '--context', CONTEXT,
                '--request-timeout=45s', *args], capture=capture, data=data)


def helm(*args, capture=False):
    return run(['helm', '--kubeconfig', str(KUBE), '--kube-context', CONTEXT,
                '--namespace', NAMESPACE, *args], capture=capture, timeout=720)


def write_kubeconfig(config):
    STATE.mkdir(mode=0o700, exist_ok=True)
    # Anchor every write to this directory; never follow a redirected state path.
    directory = os.open(STATE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fchmod(directory, 0o700)
        temporary = '.kubeconfig-' + os.urandom(8).hex()
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=directory)
        try:
            with os.fdopen(fd, 'w') as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(config)
            os.replace(temporary, KUBE.name, src_dir_fd=directory, dst_dir_fd=directory)
        finally:
            try:
                os.unlink(temporary, dir_fd=directory)
            except FileNotFoundError:
                pass
    finally:
        os.close(directory)


def local_docker():
    # Docker context metadata must agree with the workstation loopback assumption.
    endpoint = os.environ.get('DOCKER_HOST')
    if os.environ.get('DOCKER_CONTEXT') or not endpoint:
        context = json.loads(run(['docker', 'context', 'inspect'], capture=True))[0]
        endpoint = context['Endpoints']['docker']['Host']
    if urllib.parse.urlparse(endpoint).scheme != 'unix':
        raise SystemExit('Local Unix-socket Docker daemon required; remote Docker endpoints are forbidden')


def local_config():
    # Derive credentials from local Kind, never trust a same-named ambient context.
    local_docker()
    clusters = run(['kind', 'get', 'clusters'], capture=True).splitlines()
    if 'kind' not in clusters:
        raise SystemExit('Existing local Kind cluster "kind" required; no cluster will be created')
    nodes = run(['kind', 'get', 'nodes', '--name', 'kind'], capture=True).splitlines()
    if not nodes:
        raise SystemExit('Kind cluster has no local Docker nodes')
    for node in nodes:
        info = json.loads(run(['docker', 'inspect', node], capture=True))[0]
        if (info.get('Config', {}).get('Labels', {}).get('io.x-k8s.kind.cluster') != 'kind'
                or not info.get('State', {}).get('Running')):
            raise SystemExit(f'{node} is not a running local Kind node')
    config = run(['kind', 'get', 'kubeconfig', '--name', 'kind'], capture=True)
    write_kubeconfig(config)
    view = json.loads(kubectl('config', 'view', '--minify', '-o', 'json', capture=True))
    server = urllib.parse.urlparse(view['clusters'][0]['cluster']['server'])
    if server.scheme != 'https' or server.hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise SystemExit('Refusing non-loopback Kind API endpoint')
    actual_nodes = json.loads(kubectl('get', 'nodes', '-o', 'json', capture=True))['items']
    if set(nodes) != {node['metadata']['name'] for node in actual_nodes}:
        raise SystemExit('API node inventory does not match local Kind Docker nodes')


def existing(kind, name, namespace=None):
    args = ['get', kind, name, '--ignore-not-found', '-o', 'json']
    if namespace:
        args += ['--namespace', namespace]
    text = kubectl(*args, capture=True)
    return json.loads(text) if text.strip() else None


def workload_objects():
    # Let kubectl parse YAML; no third-party Python YAML dependency.
    text = kubectl('create', '--dry-run=client', '-f', str(ROOT / 'workloads.yaml'),
                   '-o', 'json', capture=True)
    # kubectl emits one JSON document per YAML object, not always a List.
    decoder = json.JSONDecoder()
    items = []
    while text.strip():
        text = text.lstrip()
        document, end = decoder.raw_decode(text)
        items.extend(document.get('items', [document]))
        text = text[end:]
    for item in items:
        meta = item['metadata']
        if meta.get('labels', {}).get(OWNER_KEY) != OWNER:
            raise SystemExit(f'Manifest object {meta["name"]} lacks fixture ownership label')
        if item['kind'] == 'Namespace':
            if meta['name'] != 'metrics-workloads':
                raise SystemExit('Unexpected workload namespace')
        elif meta.get('namespace') != 'metrics-workloads':
            raise SystemExit('Workload objects must live in metrics-workloads')
        live = existing(item['kind'], meta['name'], meta.get('namespace'))
        if live and live['metadata'].get('labels', {}).get(OWNER_KEY) != OWNER:
            raise SystemExit(f'Refusing unowned object {item["kind"]}/{meta["name"]}')
    return items


def apply_workloads(items):
    source = next(item for item in items if item['kind'] == 'ConfigMap')
    digest = hashlib.sha256(json.dumps(source['data'], sort_keys=True).encode()).hexdigest()
    for item in items:
        if item['kind'] == 'Deployment':
            item['spec']['template']['metadata'].setdefault('annotations', {})[
                'metrics-lab/source-sha256'] = digest
    kubectl('apply', '-f', '-', data=json.dumps({
        'apiVersion': 'v1', 'kind': 'List', 'items': items}))


def chart_objects(rendered):
    try:
        import yaml
    except ImportError:
        raise SystemExit('PyYAML required for chart ownership preflight; install with python3 -m pip install PyYAML') from None
    class KubernetesLoader(yaml.SafeLoader):
        pass

    # YAML 1.1 tags a plain '=' scalar as a value, although Kubernetes accepts
    # it as a string. Keep SafeLoader's other constructors and boolean handling.
    KubernetesLoader.add_constructor('tag:yaml.org,2002:value', KubernetesLoader.construct_scalar)
    return yaml.load_all(rendered, Loader=KubernetesLoader)


def chart_preflight(release_exists):
    rendered = helm('template', RELEASE, 'kube-prometheus-stack',
                    '--repo', 'https://prometheus-community.github.io/helm-charts',
                    '--version', CHART_VERSION, '--values', str(ROOT / 'values.yaml'), '--include-crds',
                    capture=True)
    versions = set(kubectl('api-versions', capture=True).splitlines())
    discovery = {}
    for item in chart_objects(rendered):
        if not item or item['apiVersion'] not in versions:
            continue  # An absent API cannot contain a colliding custom resource.
        if item['kind'] == 'CustomResourceDefinition':
            # Helm skips existing CRDs; never adopt or upgrade shared API schemas.
            live = existing('customresourcedefinition', item['metadata']['name'])
            if live:
                required = {v['name'] for v in item['spec']['versions'] if v.get('served')}
                served = {v['name'] for v in live['spec']['versions'] if v.get('served')}
                if not required <= served:
                    raise SystemExit(f'Refusing incompatible shared CRD {item["metadata"]["name"]}')
            continue
        version = item['apiVersion']
        if version not in discovery:
            endpoint = '/apis/' + version if '/' in version else '/api/' + version
            resources = json.loads(kubectl('get', '--raw', endpoint, capture=True))['resources']
            discovery[version] = {resource['kind']: resource for resource in resources
                                  if '/' not in resource['name']}
        resource = discovery[version].get(item['kind'])
        if not resource:
            continue
        meta = item['metadata']
        namespace = meta.get('namespace', NAMESPACE) if resource['namespaced'] else None
        group = version.split('/')[0] if '/' in version else ''
        name = resource['name'] + ('.' + group if group else '')
        live = existing(name, meta['name'], namespace)
        if not live:
            continue
        metadata = live['metadata']
        annotations = metadata.get('annotations', {})
        if (not release_exists
                or metadata.get('labels', {}).get('app.kubernetes.io/managed-by') != 'Helm'
                or annotations.get('meta.helm.sh/release-name') != RELEASE
                or annotations.get('meta.helm.sh/release-namespace') != NAMESPACE):
            raise SystemExit(f'Refusing chart collision {item["kind"]}/{meta["name"]}')


def owned_release():
    releases = json.loads(helm('list', '--all', '--filter', '^' + RELEASE + '$', '-o', 'json', capture=True))
    if not releases:
        return False
    values = json.loads(helm('get', 'values', RELEASE, '-o', 'json', capture=True)) or {}
    if values.get('commonLabels', {}).get(OWNER_KEY) != OWNER:
        raise SystemExit('Refusing existing Helm release without fixture ownership label')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['up', 'down', 'kubeconfig'])
    parser.add_argument('--context', default=CONTEXT)
    parser.add_argument('--confirm-down', action='store_true')
    args = parser.parse_args()
    if args.context != CONTEXT:
        parser.error('Only --context kind-kind is supported; remote targets are forbidden')
    if args.command == 'down' and not args.confirm_down:
        parser.error('down requires --confirm-down')
    local_config()
    if args.command == 'kubeconfig':
        print(KUBE)
        return
    release_exists = owned_release()
    items = workload_objects()  # Preflight all ownership before any mutation.
    if args.command == 'up':
        chart_preflight(release_exists)  # Only owned_release() can authorize an existing release.
        if not existing('namespace', NAMESPACE):
            kubectl('create', 'namespace', NAMESPACE)
        helm('upgrade', '--install', RELEASE, 'kube-prometheus-stack',
             '--repo', 'https://prometheus-community.github.io/helm-charts',
             '--version', CHART_VERSION, '--values', str(ROOT / 'values.yaml'),
             '--wait', '--timeout', '10m', '--history-max', '3')
        apply_workloads(items)
        print(f'Private kubeconfig: {KUBE}; telemetry needs several scrape intervals')
    else:
        # Retain namespaces, including unrelated resources added after setup.
        removable = [item for item in items if item['kind'] != 'Namespace']
        if removable:
            kubectl('delete', '--ignore-not-found', '--wait=true', '--timeout=90s', '-f', '-',
                    data=json.dumps({'apiVersion': 'v1', 'kind': 'List', 'items': removable}))
        if release_exists:
            helm('uninstall', RELEASE, '--wait', '--timeout', '5m')
        print('Owned workloads/release removed; namespaces, CRDs, and private kubeconfig retained')


if __name__ == '__main__':
    main()
