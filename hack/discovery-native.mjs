#!/usr/bin/env node
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { main as sandbox, run, validateContainer, validateKubeconfig } from './history-audit.mjs';

// Reuse the pinned, private, audited kind lifecycle. Never select a global context.
const [command, root] = process.argv.slice(2);
try {
  if (process.argv.length !== 4 || !['create', 'exercise', 'delete'].includes(command)
    || !path.isAbsolute(root) || path.resolve(root) !== root || root === '/') {
    throw new Error('Usage: node hack/discovery-native.mjs create|exercise|delete /absolute/private-directory');
  }
  if (command === 'create') mkdirSync(root, { mode: 0o700 });
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(root) !== root
    || (info.mode & 0o077) || info.uid !== process.getuid()) throw new Error('Expected owned private real directory');
  const roots = ['a', 'b'].map(name => path.join(root, name));
  if (command !== 'exercise') {
    for (const child of roots) sandbox([command, child]);
  } else {
    for (const child of roots) {
      const state = JSON.parse(readFileSync(path.join(child, 'owner.json'), 'utf8'));
      if (state.root !== child || state.deleted || !/^ov-history-[a-f0-9]{16}$/.test(state.name)
        || !/^unix:\/\//.test(state.endpoint)) throw new Error('Invalid owned sandbox');
      const container = JSON.parse(run('docker', ['--host', state.endpoint, 'inspect', `${state.name}-control-plane`]).stdout);
      if (container.length !== 1) throw new Error('Expected one owned container');
      validateContainer(container[0], state, child);
      validateKubeconfig(JSON.parse(run('kubectl', ['--kubeconfig', path.join(child, 'kubeconfig'), '--context', `kind-${state.name}`, 'config', 'view', '--raw', '-o', 'json']).stdout), state.name);
    }
    const sdk = path.resolve('../plugin-sdk');
    if (run('git', ['-C', sdk, 'rev-parse', 'HEAD']).stdout.trim() !== '6ce85c8b42cab1547396217510196b29e63ffe55'
      || run('git', ['-C', sdk, 'status', '--porcelain']).stdout.trim()) throw new Error('Use the exact clean approved sibling SDK');
    const moddir = mkdtempSync(path.join(root, 'sdk-'));
    const modfile = path.join(moddir, 'acceptance.mod');
    writeFileSync(modfile, readFileSync('go.mod'), { mode: 0o600, flag: 'wx' });
    writeFileSync(path.join(moddir, 'acceptance.sum'), readFileSync('go.sum'), { mode: 0o600, flag: 'wx' });
    run('go', ['mod', 'edit', '-modfile', modfile, '-replace', `github.com/omniviewdev/plugin-sdk=${sdk}`], { env: { ...process.env, GOWORK: 'off' } });
    const result = run('go', ['test', '-modfile', modfile, './pkg/plugin/resource', '-run', '^TestNativeDiscoveryAcceptance$', '-count=1', '-v', '-timeout=8m'], {
      env: { ...process.env, GOWORK: 'off', P08_NATIVE_ROOT: root }, timeout: 540000, allowFailure: true,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.status ?? 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
