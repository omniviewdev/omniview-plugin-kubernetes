import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditPolicy, inspectAudit, main, NAMESPACE, run, validateContainer, validateKubeconfig } from './history-audit.mjs';

// Evaluate first-match policy semantics against requests, including subresources.
function level(request) {
  for (const rule of auditPolicy().rules) {
    if (rule.namespaces && !rule.namespaces.includes(request.namespace)) continue;
    if (rule.verbs && !rule.verbs.includes(request.verb)) continue;
    if (rule.resources && !rule.resources.some(resource => resource.group === request.group
      && resource.resources.some(name => name === '*' || name === request.resource))) continue;
    return rule.level;
  }
}
test('body capture stays inside fixture write allowlist; sensitive endpoints remain metadata', () => {
  for (const group of ['', 'authentication.k8s.io', 'authorization.k8s.io', 'audit.fixture.omniview.dev', 'apps']) {
    for (const namespace of [NAMESPACE, 'default', undefined]) {
      for (const verb of ['get', 'list', 'watch', 'create', 'patch', 'delete', 'update', 'deletecollection']) {
        for (const resource of ['configmaps', 'configmaps/status', 'events', 'secrets', 'serviceaccounts/token', 'tokenreviews', 'subjectaccessreviews', 'samples', 'samples/status', 'deployments']) {
          const expected = namespace === NAMESPACE && ['create', 'patch', 'delete', 'update', 'deletecollection'].includes(verb)
            && ((group === '' && ['configmaps', 'events'].includes(resource)) || (group === 'audit.fixture.omniview.dev' && ['samples', 'samples/status'].includes(resource)));
          assert.equal(level({ group, namespace, verb, resource }), expected ? 'RequestResponse' : 'Metadata', JSON.stringify({ group, namespace, verb, resource }));
        }
      }
    }
  }
  assert.deepEqual(auditPolicy().omitStages, ['RequestReceived']);
});
const name = 'ov-history-0123456789abcdef';
const config = () => ({ 'current-context': `kind-${name}`, contexts: [{ name: `kind-${name}`, context: { cluster: 'local', user: 'admin' } }], clusters: [{ name: 'local', cluster: { server: 'https://127.0.0.1:12345', 'certificate-authority-data': 'cert' } }], users: [{ name: 'admin', user: { 'client-certificate-data': 'cert', 'client-key-data': 'key' } }] });
test('kubeconfig refuses remote servers, injected plugins, proxies and mismatched contexts', () => {
  validateKubeconfig(config(), name);
  for (const mutate of [
    c => { c.clusters[0].cluster.server = 'https://production.example:443'; },
    c => { c.clusters[0].cluster['proxy-url'] = 'https://remote.example'; },
    c => { c.users[0].user.exec = { command: 'malicious' }; },
    c => { c['current-context'] = 'production'; },
    c => { c.contexts[0].context.user = 'other'; },
    c => { c.clusters.push(c.clusters[0]); },
  ]) {
    const changed = config(); mutate(changed);
    assert.throws(() => validateKubeconfig(changed, name));
  }
});
test('ownership requires exact name, kind label, host mount and recorded container identity', () => {
  const state = { name, containerID: 'original' };
  const container = { Id: 'original', Name: `/${name}-control-plane`, Config: { Labels: { 'io.x-k8s.kind.cluster': name } }, Mounts: [{ Type: 'bind', Source: '/private/fixture/audit', Destination: '/var/log/history-audit', RW: true }] };
  validateContainer(container, state, '/private/fixture');
  for (const mutate of [c => { c.Id = 'replacement'; }, c => { c.Name = '/kind-control-plane'; }, c => { c.Config.Labels = {}; }, c => { c.Mounts[0].Source = '/someone-else/audit'; }, c => { c.Mounts[0].RW = false; }]) {
    const changed = structuredClone(container); mutate(changed);
    assert.throws(() => validateContainer(changed, state, '/private/fixture'), /unowned/);
  }
  const desktop = structuredClone(container);
  desktop.Mounts[0].Source = `/host_mnt${desktop.Mounts[0].Source}`;
  if (process.platform === 'darwin') validateContainer(desktop, state, '/private/fixture');
  else assert.throws(() => validateContainer(desktop, state, '/private/fixture'), /unowned/);
  for (const source of ['/host_mnt/private/other/audit', '/private/fixture/audit-suffix']) {
    const unrelated = structuredClone(container);
    unrelated.Mounts[0].Source = source;
    assert.throws(() => validateContainer(unrelated, state, '/private/fixture'), /unowned/);
  }
});
test('audit inspection retains real stage, error, dry-run URI and incarnation evidence', () => {
  const event = { auditID: 'one', stage: 'ResponseComplete', verb: 'create', objectRef: { namespace: NAMESPACE, resource: 'configmaps', name: 'incarnation' }, responseStatus: { code: 201 }, responseObject: { metadata: { uid: 'first' } } };
  const records = [event, { ...event, auditID: 'two', responseObject: { metadata: { uid: 'second' } } }, { ...event, auditID: 'denied', responseStatus: { code: 403 }, responseObject: { kind: 'Status', reason: 'Forbidden' } }, { ...event, requestURI: '/api/v1/namespaces/history-audit-fixture/configmaps?dryRun=All' }];
  const result = inspectAudit(records.map(record => JSON.stringify(record)).join('\n') + '\n');
  assert.equal(result.records, 4);
  assert.deepEqual(result.evidence.slice(0, 2).map(item => item.uid), ['first', 'second']);
  assert.equal(result.evidence[2].code, 403);
  assert.match(result.evidence[3].uri, /dryRun=All/);
  assert.throws(() => inspectAudit('{bad}\n'), /line 1/);
  assert.throws(() => inspectAudit(JSON.stringify({ ...event, stage: 'RequestReceived' })), /RequestReceived/);
  for (const objectRef of [{ namespace: 'default', resource: 'configmaps' }, { namespace: NAMESPACE, resource: 'secrets' }, { namespace: NAMESPACE, apiGroup: 'authentication.k8s.io', resource: 'tokenreviews' }]) {
    assert.throws(() => inspectAudit(JSON.stringify({ ...event, objectRef })), /outside allowlist/);
  }
});
test('invalid lifecycle inputs fail without invoking cluster tools', () => {
  for (const args of [[], ['create'], ['delete', '/'], ['exercise', './relative'], ['oops', '/tmp/fixture'], ['create', '/tmp/../fixture'], ['create', '/tmp/fixture', 'extra']]) assert.throws(() => main(args));
});
test('subprocess runner passes metacharacters literally and bounds hangs and failures', () => {
  const literal = 'x; $(touch should-not-exist)';
  const result = run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', literal]);
  assert.equal(result.stdout, literal);
  assert.throws(() => run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 100 }), /ETIMEDOUT/);
  assert.throws(() => run(process.execPath, ['-e', 'process.exit(7)']), /failed \(7\)/);
  assert.equal(run(process.execPath, ['-e', 'process.exit(7)'], { allowFailure: true }).status, 7);
});

test('filesystem ownership checks reject public directories and sandbox symlinks before cluster access', () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'history-audit-test-')));
  const link = `${root}-link`;
  try {
    chmodSync(root, 0o755);
    assert.throws(() => main(['delete', root]), /private real directory/);
    chmodSync(root, 0o700);
    symlinkSync(root, link);
    assert.throws(() => main(['delete', link]), /private real directory/);
    symlinkSync(path.join(root, 'missing-owner'), path.join(root, 'owner.json'));
    assert.throws(() => main(['delete', root]), /symlink refused/);
  } finally {
    rmSync(link, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
