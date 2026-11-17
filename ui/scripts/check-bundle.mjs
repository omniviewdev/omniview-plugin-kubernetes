import console from 'node:console';
import process from 'node:process';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { URL } from 'node:url';

// What the host's loader checks on a new-UI bundle before it runs a line of it (ui-next/plugins/loader/preflight.ts and contract/admit.ts in
// omniviewdev/omniview), made here on the build's output: a bundle the host would refuse never leaves this repository. The bundle is read as text and
// never executed.
//
//   - it is a SystemJS bundle (`System.register`), and `assets/entry.js` is there: the one file the host fetches;
//   - every dependency it declares is a file of its own or a name the host shares (ui/vendor/shared-specifiers.json: React, the kit and the runtime's
//     curated `ui/v1` entry): not the runtime's main entry, not the previous UI library, not anything the build bundled in by mistake;
//   - it exports `contributionV1`, the contribution contract's version 1;
//   - no stylesheet is left beside it (the host loads the entry only; the build folds the CSS into it), and the folded CSS is in the plugin layer.
const shared = JSON.parse(await readFile(new URL('../vendor/shared-specifiers.json', import.meta.url), 'utf8'));
const directory = resolve(process.argv[2] ?? resolve(process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY || 'dist', 'assets'));

// The same two patterns as the host's pre-flight: the first registration's dependency list, and the quoted names in it.
const REGISTRATION = /System\.register\(\s*(?:(['"])(?:(?!\1).)*\1\s*,\s*)?\[([^\]]*)\]/;
const QUOTED = /(['"])((?:(?!\1).)*)\1/g;
// The `system` format exports through the first parameter of the registered function, which a minifier renames: `x("contributionV1", value)`, or
// `x({ contributionV1: value })` when a module exports several names.
const EXPORTS_CONTRIBUTION = /[\w$]\(\s*(?:(['"])contributionV1\1\s*,|\{[^}]*\bcontributionV1\b)/;
const isLocal = (specifier) => specifier.startsWith('.') || specifier.startsWith('/');

const problems = [];
const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
const bundles = files.filter((name) => name.endsWith('.js'));

if (!bundles.includes('entry.js')) {
  problems.push(`${directory} holds no entry.js`);
}

for (const name of files.filter((file) => file.endsWith('.css'))) {
  problems.push(`${name}: a stylesheet beside the bundle; the host loads the entry only, so the build must fold the CSS into it`);
}

const imported = new Set();
for (const name of bundles) {
  const source = await readFile(resolve(directory, name), 'utf8');
  const match = REGISTRATION.exec(source);
  if (match === null) {
    problems.push(`${name}: not a SystemJS bundle (no System.register)`);
    continue;
  }

  for (const [, , dependency = ''] of (match[2] ?? '').matchAll(QUOTED)) {
    if (isLocal(dependency)) continue;
    imported.add(dependency);
    if (!shared.includes(dependency)) {
      problems.push(`${name}: imports "${dependency}", which the host does not share; the host refuses the bundle before it runs`);
    }
  }

  if (name === 'entry.js') {
    if (!EXPORTS_CONTRIBUTION.test(source)) {
      problems.push('entry.js: does not export contributionV1');
    }
    if (source.includes('data-omniview-plugin-css') && !source.includes('@layer ov.plugin {')) {
      problems.push('entry.js: injects a stylesheet that is not inside @layer ov.plugin (an unlayered sheet beats every layer the kit declares)');
    }
  }
}

if (problems.length > 0) {
  throw new Error(`The bundle in ${directory} would be refused by the host:\n  - ${problems.join('\n  - ')}`);
}

console.log(`Checked ${bundles.length} bundle file(s) in ${directory}: imports [${[...imported].sort().join(', ')}], exports contributionV1.`);
