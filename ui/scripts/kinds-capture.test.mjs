import assert from 'node:assert/strict';
import test from 'node:test';

import { kept, LAST_APPLIED } from '../../hack/kinds-capture/kept.mjs';
import { run } from '../../hack/kinds-capture/run.mjs';

// The tools that make the goldens of the detail pages (hack/kinds-capture/capture-detail.mjs): what a fixture keeps of an object, and how it runs a command.

const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJrdWJlcm5ldGVzIn0.c2lnbmF0dXJl';
const masked = (text) => 'x'.repeat(Buffer.byteLength(text));

test('a fixture keeps no managedFields, and a signed token in a ConfigMap\'s data is replaced by as many x as it has bytes', () => {
  const out = kept({ kind: 'ConfigMap', metadata: { name: 'a', managedFields: [{ manager: 'kubectl' }] }, data: { token: TOKEN, plain: 'hello' } });
  assert.equal(Object.hasOwn(out.metadata, 'managedFields'), false);
  assert.equal(out.data.token, masked(TOKEN));
  assert.equal(out.data.plain, 'hello');
});

test('a ConfigMap\'s last applied configuration is masked too: it holds the whole manifest the object was applied from, token included', () => {
  const applied = JSON.stringify({ apiVersion: 'v1', kind: 'ConfigMap', data: { token: TOKEN } });
  const out = kept({ kind: 'ConfigMap', metadata: { name: 'a', annotations: { [LAST_APPLIED]: applied, 'example.io/owner': 'team' } }, data: { token: TOKEN } });
  assert.equal(out.metadata.annotations[LAST_APPLIED], masked(applied));
  assert.equal(out.metadata.annotations['example.io/owner'], 'team');
  assert.doesNotMatch(JSON.stringify(out), /eyJ/);
});

test('a ConfigMap that holds no data or no annotation gets neither made up', () => {
  const bare = kept({ kind: 'ConfigMap', metadata: { name: 'a' } });
  assert.deepEqual(bare, { kind: 'ConfigMap', metadata: { name: 'a' } });
  const noData = kept({ kind: 'ConfigMap', metadata: { name: 'a', annotations: { [LAST_APPLIED]: '{}' } } });
  assert.equal(Object.hasOwn(noData, 'data'), false);
  assert.equal(noData.metadata.annotations[LAST_APPLIED], 'xx');
});

test('another kind keeps its last applied configuration: the page masks it and the goldens hold it', () => {
  const out = kept({ kind: 'Deployment', metadata: { name: 'a', managedFields: [{}], annotations: { [LAST_APPLIED]: '{"kind":"Deployment"}' } } });
  assert.equal(out.metadata.annotations[LAST_APPLIED], '{"kind":"Deployment"}');
  assert.equal(Object.hasOwn(out.metadata, 'managedFields'), false);
});

test('run resolves with the standard output of the command', async () => {
  assert.equal(await run('sh', ['-c', 'echo hello']), 'hello\n');
});

test('run waits for the streams to close, not for the process to exit: what a command leaves behind it still arrives', async () => {
  // The shell exits at once; the subshell it leaves behind keeps the pipe and writes 0.3 s later. A run that resolved on `exit` would have lost `late`.
  assert.equal(await run('sh', ['-c', '(sleep 0.3; echo late) & echo early']), 'early\nlate\n');
});

test('run rejects with the command, its exit code and what it said on the error stream', async () => {
  await assert.rejects(run('sh', ['-c', 'echo bad >&2; exit 3']), /^Error: sh -c echo bad >&2; exit 3 exited 3: bad\n$/);
});

test('run rejects when the command cannot be started', async () => {
  await assert.rejects(run('a-command-that-is-not-there-k2c1', []), { code: 'ENOENT' });
});
