import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { renderClusterConfig, writeClusterConfig } from './cluster-config.mjs';
import { validateClusterPorts } from './cluster-ports.mjs';

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

test('generated configs replace the destination without leaving temporary files', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'omniview-kind-'));
  try {
    const destination = path.join(directory, 'nested', 'kind.yaml');
    writeClusterConfig(destination, 'first');
    writeClusterConfig(destination, 'second');
    assert.equal(readFileSync(destination, 'utf8'), 'second');
    assert.deepEqual(readdirSync(path.dirname(destination)), ['kind.yaml']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('existing clusters must retain the requested loopback ingress mappings', () => {
  const ports = {
    '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '18080' }],
    '443/tcp': [{ HostIp: '127.0.0.1', HostPort: '18443' }],
  };
  assert.doesNotThrow(() => validateClusterPorts(ports, '18080', '18443'));
  assert.throws(() => validateClusterPorts(ports, '28080', '18443'), /recreate/);
  assert.throws(() => validateClusterPorts({}, '18080', '18443'), /recreate/);
  assert.throws(() => validateClusterPorts({
    ...ports, '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '18080' }],
  }, '18080', '18443'), /recreate/);
});

test('atomic config publication replaces a symlink instead of modifying its target', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'omniview-kind-'));
  try {
    const original = path.join(directory, 'original.yaml');
    const destination = path.join(directory, 'kind.yaml');
    writeFileSync(original, 'original');
    symlinkSync(original, destination);
    writeClusterConfig(destination, 'replacement');
    assert.equal(readFileSync(original, 'utf8'), 'original');
    assert.equal(readFileSync(destination, 'utf8'), 'replacement');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
