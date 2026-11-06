import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';

const checker = fileURLToPath(new URL('./check-runtime-imports.mjs', import.meta.url));
for (const [name, source, expectedStatus] of [
  ['rejects the original minified retired import', 'System.register(["@omniviewdev/runtime"], function () { var zs; return { setters: [function (M) { zs = M.useSnackbar; }], execute: function () {} }; });', 1],
  ['accepts supported imports without executing plugin code', 'System.register(["@omniviewdev/runtime"], function () { var hook; return { setters: [function (M) { hook = M.useResourceTypes; }], execute: function () { throw new Error("must not execute"); } }; });', 0],
  ['ignores top-level CSS DOM injection', 'document.head.appendChild(document.createElement("style")); System.register(["@omniviewdev/runtime"], function () { return { setters: [function (M) { const hook = M.useResourceTypes; }], execute: function () {} }; });', 0],
  ['accepts side-effect-only runtime dependencies', 'System.register(["@omniviewdev/runtime"], function () { return { setters: [null], execute: function () {} }; });', 0],
  ['accepts no-op runtime setters', 'System.register(["@omniviewdev/runtime"], function () { return { setters: [function () {}], execute: function () {} }; });', 0],
  ['still rejects retired imports after side-effect-only registrations', 'System.register(["@omniviewdev/runtime"], function () { return { setters: [null], execute: function () {} }; }); System.register(["@omniviewdev/runtime"], function () { var zs; return { setters: [function (M) { zs = M.useSnackbar; }], execute: function () {} }; });', 1],
  ['fails closed for an empty artifact directory', null, 1],
]) {
  test(name, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kubernetes-runtime-imports-'));
    try {
      if (source) await writeFile(join(directory, 'entry2.js'), source);
      const result = spawnSync(process.execPath, [checker, directory], { encoding: 'utf8' });
      assert.equal(result.status, expectedStatus, result.stderr);
      if (source?.includes('useSnackbar')) assert.match(result.stderr, /retired @omniviewdev\/runtime.useSnackbar/);
      if (name === 'accepts side-effect-only runtime dependencies') {
        assert.match(result.stdout, /Checked 0 production runtime import setters across 1 runtime dependencies/);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('uses the configured Vite output directory unless an explicit asset path overrides it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kubernetes-runtime-output-'));
  const output = join(directory, 'output');
  const assets = join(output, 'assets');
  const explicit = join(directory, 'explicit-assets');
  try {
    await mkdir(assets, { recursive: true });
    await mkdir(explicit);
    await writeFile(join(assets, 'entry2.js'),
      'System.register(["@omniviewdev/runtime"], function () { var zs; return { setters: [function (M) { zs = M.useSnackbar; }], execute: function () {} }; });');
    await writeFile(join(explicit, 'entry2.js'),
      'System.register(["@omniviewdev/runtime"], function () { return { setters: [function (M) { const hook = M.useNotifications; }], execute: function () {} }; });');
    const options = {
      cwd: directory,
      env: { ...process.env, OMNIVIEW_BUILD_OUTPUT_DIRECTORY: output },
      encoding: 'utf8',
    };
    const configured = spawnSync(process.execPath, [checker], options);
    assert.equal(configured.status, 1, configured.stderr);
    assert.match(configured.stderr, /retired @omniviewdev\/runtime.useSnackbar/);
    assert.doesNotMatch(configured.stderr, /ENOENT/);

    const overridden = spawnSync(process.execPath, [checker, explicit], options);
    assert.equal(overridden.status, 0, overridden.stderr);
    assert.match(overridden.stdout, /Checked 1 production runtime import setters/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
