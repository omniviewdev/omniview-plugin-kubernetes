#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE = 'kindest/node:v1.32.2@sha256:f226345927d7e348497136874b6d207e0b32cc52154ad8323129352923a3142f';
export const NAMESPACE = 'history-audit-fixture';
const writes = ['create', 'update', 'patch', 'delete', 'deletecollection'];
export function auditPolicy() {
  return {
    apiVersion: 'audit.k8s.io/v1', kind: 'Policy', omitStages: ['RequestReceived'],
    rules: [
      { level: 'Metadata', resources: [
        { group: '', resources: ['secrets', 'serviceaccounts/token'] },
        { group: 'authentication.k8s.io', resources: ['*'] },
        { group: 'authorization.k8s.io', resources: ['*'] },
      ] },
      { level: 'RequestResponse', namespaces: [NAMESPACE], verbs: writes, resources: [
        { group: '', resources: ['configmaps', 'events'] },
        { group: 'audit.fixture.omniview.dev', resources: ['samples', 'samples/status'] },
      ] },
      { level: 'Metadata' },
    ],
  };
}
export function run(binary, args, { env = process.env, input, timeout = 45000, allowFailure = false } = {}) {
  const result = spawnSync(binary, args, { env, input, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, shell: false });
  if (result.error) throw result.error;
  if (result.signal || (!allowFailure && result.status !== 0)) throw new Error(`${binary} failed (${result.signal ?? result.status}): ${result.stderr}`);
  return result;
}
export function validateContainer(container, state, root) {
  const auditPath = path.join(root, 'audit');
  const sources = new Set([auditPath]);
  if (process.platform === 'darwin') sources.add(`/host_mnt${auditPath}`);
  if (container.Name !== `/${state.name}-control-plane` || container.Config?.Labels?.['io.x-k8s.kind.cluster'] !== state.name
    || (state.containerID && container.Id !== state.containerID)
    || !container.Mounts?.some(m => m.Type === 'bind' && sources.has(m.Source) && m.Destination === '/var/log/history-audit' && m.RW)) {
    throw new Error('Refusing unowned or replaced container');
  }
}
export function validateKubeconfig(config, name) {
  if (config['current-context'] !== `kind-${name}` || config.contexts?.length !== 1 || config.clusters?.length !== 1 || config.users?.length !== 1) throw new Error('Unexpected private kubeconfig');
  const context = config.contexts[0];
  const cluster = config.clusters[0];
  const user = config.users[0];
  if (context.name !== `kind-${name}` || context.context?.cluster !== cluster.name || context.context?.user !== user.name
    || !/^https:\/\/127\.0\.0\.1:[0-9]+$/.test(cluster.cluster?.server)
    || !cluster.cluster?.['certificate-authority-data'] || cluster.cluster?.['insecure-skip-tls-verify']
    || Object.keys(cluster.cluster ?? {}).some(key => !['server', 'certificate-authority-data'].includes(key))
    || Object.keys(user.user ?? {}).some(key => !['client-certificate-data', 'client-key-data'].includes(key))
    || !user.user?.['client-certificate-data'] || !user.user?.['client-key-data']) throw new Error('Refusing non-local or executable kubeconfig');
}
function privateFile(file, data) { writeFileSync(file, data, { mode: 0o600, flag: 'wx' }); }
function save(root, state) { writeFileSync(path.join(root, 'owner.json'), JSON.stringify(state, null, 2), { mode: 0o600 }); }
function load(root) {
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(root) !== root || (info.mode & 0o077) || info.uid !== process.getuid()) throw new Error('Sandbox must be an owned private real directory');
  for (const name of ['owner.json', 'audit']) if (lstatSync(path.join(root, name)).isSymbolicLink()) throw new Error('Sandbox symlink refused');
  const state = JSON.parse(readFileSync(path.join(root, 'owner.json'), 'utf8'));
  if (state.version !== 1 || !/^ov-history-[a-f0-9]{16}$/.test(state.name) || !/^unix:\/\//.test(state.endpoint) || state.root !== root) throw new Error('Invalid sandbox owner record');
  return state;
}
function docker(state, args, options) { return run('docker', ['--host', state.endpoint, ...args], options); }
function environment(state, root) { return { ...process.env, DOCKER_HOST: state.endpoint, DOCKER_CONTEXT: '', KIND_EXPERIMENTAL_PROVIDER: 'docker', KUBECONFIG: path.join(root, 'kubeconfig') }; }
function owned(state, root) {
  const containers = JSON.parse(docker(state, ['inspect', `${state.name}-control-plane`]).stdout);
  if (containers.length !== 1) throw new Error('Expected one sandbox container');
  validateContainer(containers[0], state, root);
  return containers[0];
}
function kube(state, root, args, options = {}) {
  return run('kubectl', ['--kubeconfig', path.join(root, 'kubeconfig'), '--context', `kind-${state.name}`, '--request-timeout=20s', ...args], { ...options, env: environment(state, root) });
}
function verifyKube(state, root) {
  if (!lstatSync(path.join(root, 'kubeconfig')).isFile()) throw new Error('Private kubeconfig must be a regular file');
  validateKubeconfig(JSON.parse(kube(state, root, ['config', 'view', '--raw', '-o', 'json']).stdout), state.name);
}
export function inspectAudit(text) {
  const records = text.split('\n').filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`Malformed audit JSONL at line ${index + 1}`); }
  });
  const selected = records.filter(event => event.objectRef?.namespace === NAMESPACE);
  for (const event of records) {
    if (event.requestObject !== undefined || event.responseObject !== undefined) {
      const ref = event.objectRef ?? {};
      const allowed = ref.namespace === NAMESPACE && writes.includes(event.verb)
        && ((!(ref.apiGroup) && ['configmaps', 'events'].includes(ref.resource) && !ref.subresource)
          || (ref.apiGroup === 'audit.fixture.omniview.dev' && ref.resource === 'samples' && [undefined, '', 'status'].includes(ref.subresource)));
      if (!allowed) throw new Error(`Audit body outside allowlist: ${event.auditID}`);
    }
    if (event.stage === 'RequestReceived') throw new Error('Unexpected RequestReceived stage');
  }
  return { records: records.length, fixtureRecords: selected.length, evidence: selected.map(event => ({
    auditID: event.auditID, stage: event.stage, verb: event.verb, uri: event.requestURI,
    resource: event.objectRef?.resource, subresource: event.objectRef?.subresource,
    name: event.objectRef?.name, code: event.responseStatus?.code,
    uid: event.responseObject?.metadata?.uid ?? event.objectRef?.uid,
  })) };
}
export function main(argv) {
  if (argv.length !== 2 || !['create', 'exercise', 'inspect', 'delete'].includes(argv[0]) || !path.isAbsolute(argv[1])) throw new Error('Usage: node hack/history-audit.mjs create|exercise|inspect|delete /absolute/new-private-directory');
  const [command, supplied] = argv;
  const root = path.resolve(supplied);
  if (root !== supplied || root === '/') throw new Error('Use a canonical absolute sandbox path');
  if (command === 'create') {
    const version = run('kind', ['version']).stdout;
    if (!/kind v0\.27\.0\b/.test(version)) throw new Error('Install kind v0.27.0 for the pinned image');
    const context = run('docker', ['context', 'show']).stdout.trim();
    const endpoint = JSON.parse(run('docker', ['context', 'inspect', context]).stdout)[0]?.Endpoints?.docker?.Host;
    if (!/^unix:\/\//.test(endpoint ?? '') || process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) throw new Error('Use a local unix Docker context without DOCKER_HOST/DOCKER_CONTEXT overrides');
    mkdirSync(root, { mode: 0o700 });
    if (realpathSync(root) !== root) throw new Error('Sandbox parent must not contain symlinks');
    mkdirSync(path.join(root, 'audit'), { mode: 0o700 });
    privateFile(path.join(root, 'audit', 'audit.jsonl'), '');
    const state = { version: 1, root, endpoint, name: `ov-history-${randomBytes(8).toString('hex')}` };
    save(root, state);
    const existing = run('kind', ['get', 'clusters'], { env: environment(state, root) }).stdout.split(/\s+/);
    if (existing.includes(state.name)) throw new Error('Refusing existing cluster; no resources changed');
    privateFile(path.join(root, 'policy.json'), JSON.stringify(auditPolicy(), null, 2));
    const config = { kind: 'Cluster', apiVersion: 'kind.x-k8s.io/v1alpha4', networking: { apiServerAddress: '127.0.0.1' }, nodes: [{ role: 'control-plane', extraMounts: [
      { hostPath: path.join(root, 'audit'), containerPath: '/var/log/history-audit' },
      { hostPath: path.join(root, 'policy.json'), containerPath: '/etc/kubernetes/history-audit-policy.json', readOnly: true },
    ], kubeadmConfigPatches: [JSON.stringify({ kind: 'ClusterConfiguration', apiServer: { extraArgs: {
      'audit-policy-file': '/etc/kubernetes/history-audit-policy.json', 'audit-log-path': '/var/log/history-audit/audit.jsonl',
      'audit-log-mode': 'blocking', 'audit-log-maxage': '1', 'audit-log-maxbackup': '1', 'audit-log-maxsize': '20',
    }, extraVolumes: [
      { name: 'history-audit-policy', hostPath: '/etc/kubernetes/history-audit-policy.json', mountPath: '/etc/kubernetes/history-audit-policy.json', readOnly: true, pathType: 'File' },
      { name: 'history-audit-log', hostPath: '/var/log/history-audit', mountPath: '/var/log/history-audit', readOnly: false, pathType: 'Directory' },
    ] } })] }] };
    privateFile(path.join(root, 'kind.json'), JSON.stringify(config, null, 2));
    run('kind', ['create', 'cluster', '--name', state.name, '--image', IMAGE, '--config', path.join(root, 'kind.json'), '--kubeconfig', path.join(root, 'kubeconfig'), '--wait', '180s', '--retain'], { env: environment(state, root), timeout: 300000 });
    state.containerID = owned(state, root).Id;
    save(root, state);
    chmodSync(path.join(root, 'kubeconfig'), 0o600);
    console.log(JSON.stringify({ root, name: state.name, context: `kind-${state.name}`, kubeconfig: path.join(root, 'kubeconfig') }, null, 2));
    return;
  }
  const state = load(root);
  if (command === 'inspect') {
    const log = path.join(root, 'audit', 'audit.jsonl');
    if (!lstatSync(log).isFile() || statSync(log).size > 24 * 1024 * 1024) throw new Error('Audit log missing, nonregular, or too large');
    console.log(JSON.stringify(inspectAudit(readFileSync(log, 'utf8')), null, 2));
    return;
  }
  owned(state, root);
  if (command === 'delete') {
    run('kind', ['delete', 'cluster', '--name', state.name, '--kubeconfig', path.join(root, 'kubeconfig')], { env: environment(state, root), timeout: 120000 });
    state.deleted = true;
    save(root, state);
    console.log('Deleted owned cluster; private evidence directory retained.');
    return;
  }
  verifyKube(state, root);
  const k = (args, options) => kube(state, root, args, options);
  const object = manifest => JSON.parse(k(['create', '-f', '-', '-o', 'json'], { input: JSON.stringify(manifest) }).stdout);
  object({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: NAMESPACE } });
  object({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'metadata-only-probe', namespace: NAMESPACE }, stringData: { value: 'synthetic-secret-must-not-be-audited' } });
  object({ apiVersion: 'authentication.k8s.io/v1', kind: 'TokenReview', spec: { token: 'synthetic-invalid-token-must-not-be-audited' } });
  const cm = { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'incarnation', namespace: NAMESPACE }, data: { value: 'first' } };
  const first = object(cm);
  k(['-n', NAMESPACE, 'patch', 'configmap', 'incarnation', '--type=merge', '-p', '{"data":{"value":"patched"}}']);
  k(['-n', NAMESPACE, 'create', 'configmap', 'dry-run', '--from-literal=value=not-persisted', '--dry-run=server', '-o', 'json']);
  const denied = k(['--as=history-audit-denied', '-n', NAMESPACE, 'create', 'configmap', 'denied', '--from-literal=value=denied'], { allowFailure: true });
  if (denied.status === 0 || !/\bforbidden\b/i.test(denied.stderr)) throw new Error('Expected explicit RBAC Forbidden denial');
  k(['-n', NAMESPACE, 'delete', 'configmap', 'incarnation', '--wait=true', '--timeout=20s']);
  const second = object(cm);
  if (!first.metadata.uid || first.metadata.uid === second.metadata.uid) throw new Error('Recreation did not produce distinct UIDs');
  object({ apiVersion: 'v1', kind: 'Event', metadata: { name: 'fixture-event', namespace: NAMESPACE }, involvedObject: { apiVersion: 'v1', kind: 'ConfigMap', name: 'incarnation', namespace: NAMESPACE, uid: second.metadata.uid }, reason: 'Fixture', message: 'Non-sensitive audit fixture', type: 'Normal' });
  object({ apiVersion: 'apiextensions.k8s.io/v1', kind: 'CustomResourceDefinition', metadata: { name: 'samples.audit.fixture.omniview.dev' }, spec: { group: 'audit.fixture.omniview.dev', names: { plural: 'samples', singular: 'sample', kind: 'Sample' }, scope: 'Namespaced', versions: [{ name: 'v1', served: true, storage: true, subresources: { status: {} }, schema: { openAPIV3Schema: { type: 'object', properties: { spec: { type: 'object', properties: { value: { type: 'string' } } }, status: { type: 'object', properties: { phase: { type: 'string' } } } } } } }] } });
  k(['wait', '--for=condition=Established', 'crd/samples.audit.fixture.omniview.dev', '--timeout=30s']);
  object({ apiVersion: 'audit.fixture.omniview.dev/v1', kind: 'Sample', metadata: { name: 'fixture-sample', namespace: NAMESPACE }, spec: { value: 'fixture' } });
  k(['-n', NAMESPACE, 'patch', 'samples.audit.fixture.omniview.dev', 'fixture-sample', '--subresource=status', '--type=merge', '-p', '{"status":{"phase":"Observed"}}']);
  const result = { firstUID: first.metadata.uid, recreatedUID: second.metadata.uid, denied: 'Forbidden', dryRun: 'server', context: `kind-${state.name}` };
  privateFile(path.join(root, 'exercise.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
