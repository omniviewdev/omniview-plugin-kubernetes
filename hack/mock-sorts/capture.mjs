// Captures what the design mock says about how each kind's list sorts, from the mock's own definitions (`K8s.resourceDefinitions.list()`, k8s-resource-definitions.js, which
// holds them with no connection: the printer columns, each column's `sort` and the list's `defaultSort`), into ui/src/kinds/mock-sorts.json. The plugin's kind definitions are held
// to that file by ui/src/kinds/sort.test.ts (every column the mock sorts has a key, with the mock's comparison; every kind opens on the mock's default sort).
//
//   node hack/mock-sorts/capture.mjs <mock directory> <a directory with playwright in its node_modules>
//
// The mock is read-only: its own server (mock/server.js) is started on a free port and stopped, and nothing is written there. Playwright is not a dependency of the plugin: the second argument says
// where to take it from (a host checkout that has run `pnpm install`).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [mock, from] = process.argv.slice(2);
if (mock === undefined || from === undefined) {
  throw new Error('usage: node hack/mock-sorts/capture.mjs <mock directory> <directory with playwright>');
}

const { chromium } = createRequire(path.join(path.resolve(from), 'package.json'))('playwright');
const port = 48800 + Math.floor(Math.random() * 100);
// The mock's server.js is CommonJS in a folder whose package.json says `module`, so `node server.js` refuses it; the unmodified file is run as a function of `require` and `__dirname` instead.
const WRAPPER = "const fs = require('fs'); const path = require('path'); const dir = process.argv[1]; new Function('require', '__dirname', fs.readFileSync(path.join(dir, 'server.js'), 'utf8'))(require, dir);";
const server = spawn('node', ['-e', WRAPPER, path.resolve(mock)], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes('listening')) resolve(undefined);
  });
  server.on('exit', () => reject(new Error('the mock server ended before it listened')));
});

try {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => window.K8s?.resourceDefinitions?.list !== undefined, null, { timeout: 90_000 });
  const definitions = await page.evaluate(() =>
    window.K8s.resourceDefinitions.list().map((definition) => ({
      type: definition.logicalType ?? definition.type,
      kind: definition.kind,
      defaultSort: definition.list.defaultSort,
      columns: definition.columns.map(({ id, label, sort, format, defaultHidden }) => ({ id, label, sort, format, defaultHidden })),
    })),
  );
  await browser.close();
  if (definitions.length === 0 || definitions.some((definition) => definition.type === undefined)) {
    throw new Error(`the mock gave ${definitions.length} definitions, some with no type: ${JSON.stringify(definitions[0])}`);
  }

  const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../ui/src/kinds/mock-sorts.json');
  writeFileSync(target, `${JSON.stringify({ source: 'k8s-resource-definitions.js: K8s.resourceDefinitions.list(), no connection', definitions }, null, 2)}\n`);
  console.log(`${definitions.length} definitions written to ${target}`);
} finally {
  server.kill();
}
