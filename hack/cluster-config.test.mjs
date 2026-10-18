import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderClusterConfig } from './cluster-config.mjs';

const template = readFileSync(new URL('./kind-config.yaml', import.meta.url), 'utf8');
test('optional clusters render independent loopback ingress ports', () => {
  const config = renderClusterConfig(template, '18080', '18443');
  assert.match(config, /hostPort: 18080/);
  assert.match(config, /hostPort: 18443/);
  assert.equal(config.match(/listenAddress: "127\.0\.0\.1"/g).length, 2);
  assert.doesNotMatch(config, /__HTTP|__HTTPS/);
});

test('invalid and colliding ingress ports fail before writing a config', () => {
  for (const ports of [['0', '443'], ['65536', '443'], ['80;bad', '443'], ['443', '443']]) {
    assert.throws(() => renderClusterConfig(template, ...ports));
  }
});
