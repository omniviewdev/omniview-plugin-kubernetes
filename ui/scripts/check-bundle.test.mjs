import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';

const checker = fileURLToPath(new URL('./check-bundle.mjs', import.meta.url));

/** A bundle as Rollup's `system` format writes it: the dependency list, then the module that exports. */
const bundle = (dependencies, exported = 'exports("contributionV1", {});', extra = '') =>
  `System.register([${dependencies.map((name) => JSON.stringify(name)).join(',')}], (function (exports) { return { setters: [], execute: (function () { ${exported} }) }; }));${extra}`;

const HEALTHY = [
  'react/compiler-runtime',
  '@omniviewdev/kit',
  'react',
  'react/jsx-runtime',
  '@omniviewdev/runtime/ui/v1',
];
const STYLE = (css) =>
  `\n;(function(){var s=document.createElement('style');s.setAttribute('data-omniview-plugin-css','kubernetes');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})();\n`;
const published = JSON.parse(
  await readFile(new URL('../extension-points/package.json', import.meta.url), 'utf8'),
);
const point = {
  id: 'service-tabs',
  label: 'Service detail tabs',
  kind: 'view',
  placement: 'detail-tab',
  protocol: 'kubernetes/service-view@1',
  fields: {},
  contract: { package: published.name, version: published.version, export: 'serviceTabs' },
};
const catalogue = { schemaVersion: 1, id: 'kubernetes', points: [point], offers: [], bindings: [] };

async function check(files, id = 'kubernetes') {
  const directory = await mkdtemp(join(tmpdir(), 'kubernetes-bundle-'));
  try {
    for (const [name, source] of Object.entries(files))
      await writeFile(join(directory, name), source);
    return spawnSync(process.execPath, [checker, directory], {
      encoding: 'utf8',
      env: { ...process.env, OMNIVIEW_PLUGIN_ID: id },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

for (const [name, files, expectedStatus, pattern] of [
  [
    'accepts a bundle that imports the shared names and exports contributionV1',
    { 'entry.js': bundle(HEALTHY) },
    0,
    /exports contributionV1/,
  ],
  [
    'accepts the export written as an object',
    { 'entry.js': bundle(HEALTHY, 'exports({ contributionV1: contributionV1, other: other });') },
    0,
    undefined,
  ],
  [
    "accepts the export under a minifier's name for `exports`",
    { 'entry.js': bundle(HEALTHY, 'const en=Je("contributionV1",{plugin:{}});') },
    0,
    undefined,
  ],
  [
    'accepts a chunk of its own',
    {
      'entry.js': bundle([...HEALTHY, './helper-1a2b3c.js']),
      'helper-1a2b3c.js': bundle(['react'], ''),
    },
    0,
    undefined,
  ],
  [
    'accepts folded CSS inside the plugin layer',
    { 'entry.js': bundle(HEALTHY, undefined, STYLE('@layer ov.plugin {\n.a{}\n}')) },
    0,
    undefined,
  ],

  [
    'rejects the previous UI library',
    { 'entry.js': bundle([...HEALTHY, '@omniviewdev/base-ui']) },
    1,
    /imports "@omniviewdev\/base-ui", which the host does not share/,
  ],
  [
    "rejects the runtime's main entry (only its curated `ui/v1` is shared)",
    { 'entry.js': bundle([...HEALTHY, '@omniviewdev/runtime']) },
    1,
    /imports "@omniviewdev\/runtime", which the host does not share/,
  ],
  [
    'rejects any other name the host does not share (react-dom)',
    { 'entry.js': bundle([...HEALTHY, 'react-dom']) },
    1,
    /imports "react-dom"/,
  ],
  [
    'rejects a bundle that does not export contributionV1',
    { 'entry.js': bundle(HEALTHY, 'exports("plugin", {});') },
    1,
    /does not export contributionV1/,
  ],
  [
    'rejects a bundle that is not SystemJS',
    { 'entry.js': 'export const contributionV1 = {};' },
    1,
    /not a SystemJS bundle/,
  ],
  [
    'rejects a stylesheet left beside the bundle',
    { 'entry.js': bundle(HEALTHY), 'style.css': '.a{}' },
    1,
    /style\.css: a stylesheet beside the bundle/,
  ],
  [
    'rejects folded CSS outside the plugin layer',
    { 'entry.js': bundle(HEALTHY, undefined, STYLE('.a{}')) },
    1,
    /not inside @layer ov\.plugin/,
  ],
  [
    'rejects a directory without entry.js',
    { 'other.js': bundle(HEALTHY) },
    1,
    /holds no entry\.js/,
  ],
  ['fails closed for an empty directory', {}, 1, /holds no entry\.js/],
]) {
  test(name, async () => {
    const result = await check({ 'extensions.v1.json': JSON.stringify(catalogue), ...files });
    assert.equal(result.status, expectedStatus, result.stderr);
    if (pattern) assert.match(expectedStatus === 0 ? result.stdout : result.stderr, pattern);
  });
}

test('requires the canonical owner catalogue and its pinned public names without shipping contributor code', async () => {
  const ordinary = { 'entry.js': bundle(HEALTHY) };
  const packed = { ...ordinary, 'extensions.v1.json': JSON.stringify(catalogue) };
  assert.match((await check(ordinary)).stderr, /canonical owner is missing/);
  assert.equal((await check(ordinary, 'kubernetes-channel')).status, 0);
  assert.match((await check(packed, 'kubernetes-channel')).stderr, /alternate ID cannot publish/);
  for (const corrupted of [
    { ...catalogue, offers: [{ id: 'sample' }] },
    { ...catalogue, bindings: [{ target: 'foreign' }] },
    { ...catalogue, points: [{ ...point, contract: { ...point.contract, version: '0.0.1' } }] },
  ]) {
    assert.match(
      (await check({ ...ordinary, 'extensions.v1.json': JSON.stringify(corrupted) })).stderr,
      /pinned public named exports/,
    );
  }
  assert.match(
    (await check({ ...packed, 'views.js': bundle([], '') })).stderr,
    /cannot contain contributor/,
  );
});

test('reads the Vite output directory unless an explicit path overrides it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kubernetes-bundle-output-'));
  const output = join(directory, 'output');
  const explicit = join(directory, 'explicit');
  try {
    await mkdir(join(output, 'assets'), { recursive: true });
    await mkdir(explicit);
    await writeFile(
      join(output, 'assets', 'entry.js'),
      bundle([...HEALTHY, '@omniviewdev/base-ui']),
    );
    await writeFile(join(explicit, 'entry.js'), bundle(HEALTHY));
    for (const dir of [join(output, 'assets'), explicit])
      await writeFile(join(dir, 'extensions.v1.json'), JSON.stringify(catalogue));
    const options = {
      cwd: directory,
      env: {
        ...process.env,
        OMNIVIEW_PLUGIN_ID: 'kubernetes',
        OMNIVIEW_BUILD_OUTPUT_DIRECTORY: output,
      },
      encoding: 'utf8',
    };

    const configured = spawnSync(process.execPath, [checker], options);
    assert.equal(configured.status, 1, configured.stderr);
    assert.match(configured.stderr, /imports "@omniviewdev\/base-ui"/);
    assert.doesNotMatch(configured.stderr, /ENOENT/);

    const overridden = spawnSync(process.execPath, [checker, explicit], options);
    assert.equal(overridden.status, 0, overridden.stderr);
    assert.match(overridden.stdout, /Checked 1 bundle file\(s\)/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
