// The sort proof (K3a): the real host in a real browser, the real plugin on a real cluster. For each kind it opens the list, presses every sortable header twice and holds the order of the rows on screen to
// the rule of the mock (k8s-resources.js:384-421), applied to what the cluster says (the Table the API server prints for `kubectl get`: the cells kubectl shows; each object's creationTimestamp for an age; a
// Job's start and completion for its duration): text in natural order, numbers as numbers, an age as when it was made (the oldest first when ascending), a ratio by its fraction and then its total, a missing
// value (a dash on screen) last in either direction, and a tie in the pressed column in the list's default order (name ascending; two rows with one name stand either way: the plugin hands such a tie over in
// the order of the host's opaque row key, which the cluster cannot say). Then it changes the cluster while a sort is in force and holds the list to the rule again.
//
//   node hack/sort-proof/proof.mjs --base=http://127.0.0.1:PORT --kubeconfig=<admin kubeconfig> --playwright=<directory with playwright> --out=<directory> [--engine=webkit|chromium] [--mode=proof|pairing|warm]
//                                  [--kinds=Pods,...|none] [--live=false] [--fresh=true] [--control=reversed]
//
//   --mode=proof    every sortable header twice, the live change, the screenshot (Pods sorted by Restarts, descending)
//   --mode=pairing  the Pods list opens and shows its rows without a runtime error; what a header press does is reported, nothing is asserted about it (a plugin and a host that do not agree on sorting)
//   --mode=warm     opens the plugin and leaves, so that its connection is started: the first load on a cold host logs one 422 from a `Catalog` call (seen with the OLD plugin on the OLD host as well)
//   --fresh=true    the host forgets the window it saved, so the page opens as a first run does
//   --control=reversed  the proof's own control: the page is held to the OPPOSITE direction, so every press whose two directions order the rows differently must fail
//
// The page's own errors (console errors, page errors, any response of 400 or more) are collected and reported: a run with one is not clean. A read the page itself cancelled (`omniview:cancelled`, which the host's
// binding sends as a 422) is counted apart. The cluster and the page move under a run (a crashing Pod restarts): a list that is out of order is read again, up to three times, each time against a fresh Table.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...rest] = arg.replace(/^--/, '').split('='); return [key, rest.join('=')]; }));
const need = (name) => { if (!args[name]) throw new Error(`missing --${name}=`); return args[name]; };
const base = need('base');
const kubeconfig = path.resolve(need('kubeconfig'));
const out = path.resolve(need('out'));
const engineName = args.engine || 'webkit';
const mode = args.mode || 'proof';
const { webkit, chromium } = createRequire(path.join(path.resolve(need('playwright')), 'package.json'))('playwright');
fs.mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const kubectl = (...a) => execFileSync('kubectl', ['--kubeconfig', kubeconfig, ...a], { encoding: 'utf8', timeout: 90_000 });

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The kinds: where each is in the sidebar, where the cluster prints it, and how each column of the list compares.                  */
/* ------------------------------------------------------------------------------------------------------------------------------ */

// A column is its header's words. `kind` is the mock's comparison; `cell` is the column of the printed Table it reads (none: the object's creationTimestamp, or, for `dom`, the words the list shows).
const KINDS = {
  Pods: { item: /^Pods(\s|$)/, group: 'Workloads', api: '/api/v1/pods', namespaced: true, columns: { Name: { kind: 'text', cell: 'Name' }, Ready: { kind: 'ratio', cell: 'Ready' }, Status: { kind: 'text', cell: 'Status' }, Restarts: { kind: 'int', cell: 'Restarts' }, Age: { kind: 'time' } } },
  // A Deployment's Status is a word the plugin derives (kubectl prints no such column): the words on screen are the keys, the order of them is what is held.
  Deployments: { item: /^Deployments(\s|$)/, group: 'Workloads', api: '/apis/apps/v1/deployments', namespaced: true, columns: { Name: { kind: 'text', cell: 'Name' }, Status: { kind: 'text', dom: true }, Ready: { kind: 'ratio', cell: 'Ready' }, 'Up-to-date': { kind: 'int', cell: 'Up-to-date' }, Age: { kind: 'time' } } },
  Nodes: { item: /^Nodes(\s|$)/, group: 'Cluster', api: '/api/v1/nodes', namespaced: false, columns: { Name: { kind: 'text', cell: 'Name' }, Roles: { kind: 'text', cell: 'Roles' }, Status: { kind: 'text', cell: 'Status' }, Version: { kind: 'text', cell: 'Version' }, Age: { kind: 'time' } } },
  // A Job's Duration is read from its objects, to the second (kubectl prints "12m" for a span of twelve minutes and some seconds): a Job that has not finished is read against now, as kubectl and the plugin read it.
  Jobs: { item: /^Jobs(\s|$)/, group: 'Workloads', api: '/apis/batch/v1/jobs', namespaced: true, columns: { Name: { kind: 'text', cell: 'Name' }, Status: { kind: 'text', cell: 'Status' }, Completions: { kind: 'ratio', cell: 'Completions' }, Duration: { kind: 'seconds' }, Age: { kind: 'time' } } },
  PersistentVolumeClaims: { item: /^Persistent ?Volume ?Claims(\s|$)/, group: 'Storage', api: '/api/v1/persistentvolumeclaims', namespaced: true, columns: { Name: { kind: 'text', cell: 'Name' }, Status: { kind: 'text', cell: 'Status' }, Volume: { kind: 'text', cell: 'Volume' }, Capacity: { kind: 'quantity', cell: 'Capacity' }, 'Storage class': { kind: 'text', cell: 'StorageClass' }, Age: { kind: 'time' } } },
};
const wanted = args.kinds === 'none' ? [] : (args.kinds || 'Pods,Deployments,Nodes,Jobs,PersistentVolumeClaims').split(',');

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* What the cluster says: the Table of `kubectl get`, fetched through `kubectl proxy` (our own process, stopped by its pid).          */
/* ------------------------------------------------------------------------------------------------------------------------------ */

async function startProxy() {
  const child = spawn('kubectl', ['--kubeconfig', kubeconfig, 'proxy', '--port=0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { const match = String(chunk).match(/127\.0\.0\.1:(\d+)/); if (match) resolve(Number(match[1])); });
    child.on('exit', () => reject(new Error('kubectl proxy ended before it served')));
  });
  return { port, stop: () => child.kill() };
}

async function snapshot(proxy, spec) {
  const get = async (accept) => {
    const response = await fetch(`http://127.0.0.1:${proxy.port}${spec.api}`, { headers: { accept } });
    if (!response.ok) throw new Error(`${spec.api}: ${response.status}`);
    return response.json();
  };
  const table = await get('application/json;as=Table;v=v1;g=meta.k8s.io');
  const idOf = (metadata) => (spec.namespaced ? `${metadata.namespace}/${metadata.name}` : metadata.name);
  const objects = Object.values(spec.columns).some((column) => column.kind === 'seconds') ? new Map((await get('application/json')).items.map((item) => [idOf(item.metadata), item])) : new Map();
  const names = table.columnDefinitions.map((column) => column.name.replace(/\s+/g, ''));
  return table.rows.map((row) => ({
    id: idOf(row.object.metadata),
    name: row.object.metadata.name,
    created: Date.parse(row.object.metadata.creationTimestamp),
    cells: Object.fromEntries(names.map((name, index) => [name, row.cells[index]])),
    object: objects.get(idOf(row.object.metadata)),
  }));
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The mock's comparisons, as keys. `undefined` is a missing value.                                                                  */
/* ------------------------------------------------------------------------------------------------------------------------------ */

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const UNITS = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15 };

function keyOf(column, row, domText) {
  // A cell the list shows as a dash has no value (the plugin never says zero for what the cluster has not reported: a Pod with no container status has no restart count, where kubectl prints 0), and a missing
  // value is last either way. `dashAudit` holds every dash to the cluster: a dash is only for a value the cluster does not have.
  if (column.kind !== 'time' && /^[—–-]?$/.test(domText ?? '')) return undefined;
  const text = column.dom ? domText : row.cells[column.cell];
  switch (column.kind) {
    case 'time': return row.created;
    case 'text': return text === undefined || text === null || text === '' ? undefined : String(text);
    case 'int': { const match = String(text ?? '').match(/^\s*(\d+)/); return match ? Number(match[1]) : undefined; }
    case 'ratio': { const match = String(text ?? '').match(/^(\d+)\/(\d+)(?: of \d+)?$/); return match ? { ready: Number(match[1]), total: Number(match[2]) } : undefined; }
    case 'seconds': {
      const start = Date.parse(row.object?.status?.startTime ?? '');
      if (Number.isNaN(start)) return undefined;
      const end = Date.parse(row.object?.status?.completionTime ?? '');
      return Math.floor(((Number.isNaN(end) ? Date.now() : end) - start) / 1000);
    }
    case 'quantity': {
      const match = String(text ?? '').match(/^([0-9.]+)(Ki|Mi|Gi|Ti|Pi|k|M|G|T|P)?$/);
      return match ? Number(match[1]) * (match[2] ? UNITS[match[2]] : 1) : undefined;
    }
    default: throw new Error(`no such comparison: ${column.kind}`);
  }
}

function compare(a, b) {
  if (typeof a === 'object') { return (a.total === 0 ? 1 : a.ready / a.total) - (b.total === 0 ? 1 : b.ready / b.total) || a.total - b.total; }
  if (typeof a === 'string') { return collator.compare(a, b); }
  return a - b;
}

/**
 * Whether the rows are in the order the rule gives, and where they first are not. The rule is a total preorder: the column's key (a missing value last either way), then the list's default order (name ascending).
 * So a list is in order when no row stands after one that is meant to follow it. Two rows with one key AND one name may stand either way: the plugin hands such a tie over in the order of the host's opaque row key
 * (`row:04b0bc2b`), which the cluster cannot say (two Deployments called `web`, in two namespaces, stand in either order from one session to the next).
 */
function orderProblem(ids, rows, spec, header, direction, domById) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (new Set(ids).size !== ids.length || ids.length !== rows.length || ids.some((id) => !byId.has(id))) {
    return { rowsDiffer: true, counts: [ids.length, rows.length], onlyOnScreen: ids.filter((id) => !byId.has(id)).slice(0, 3), onlyInCluster: rows.filter((row) => !ids.includes(row.id)).map((row) => row.id).slice(0, 3) };
  }

  const column = spec.columns[header];
  const sign = direction === 'descending' ? -1 : 1;
  const keyed = ids.map((id) => ({ id, name: byId.get(id).name, key: keyOf(column, byId.get(id), domById.get(id)?.[header]) }));
  for (let at = 1; at < keyed.length; at += 1) {
    const [a, b] = [keyed[at - 1], keyed[at]];
    let order = a.key === undefined || b.key === undefined ? (a.key === b.key ? 0 : a.key === undefined ? 1 : -1) : compare(a.key, b.key) * sign;
    if (order === 0) order = collator.compare(a.name, b.name);
    if (order > 0) return { at, pair: [a.id, b.id], keys: [a.key ?? null, b.key ?? null] };
  }

  return undefined;
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The page.                                                                                                                         */
/* ------------------------------------------------------------------------------------------------------------------------------ */

/** Page side: every row of the list in the order it is drawn (the table draws a window of the rows: the scroll region is walked, top to bottom). */
const READ_ROWS = async () => {
  const region = document.querySelector('[data-shell-part="page"] [role="region"]');
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const seen = new Map();
  const collect = () => {
    for (const tr of document.querySelectorAll('table tbody tr[data-ov-index]')) {
      const index = Number(tr.getAttribute('data-ov-index'));
      if (!seen.has(index)) seen.set(index, [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()));
    }
  };
  region.scrollTop = 0;
  await pause(150);
  collect();
  const step = Math.max(region.clientHeight - 120, 80);
  for (let guard = 0; region.scrollTop + region.clientHeight < region.scrollHeight - 2 && guard < 600; guard += 1) {
    region.scrollTop = Math.min(region.scrollTop + step, region.scrollHeight);
    await pause(100);
    collect();
  }
  region.scrollTop = region.scrollHeight;
  await pause(150);
  collect();
  region.scrollTop = 0;
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([index, cells]) => ({ index, cells }));
};

const HEADERS = () => [...document.querySelectorAll('table thead th')].map((th) => ({ text: th.innerText.trim(), sort: th.getAttribute('aria-sort'), button: th.querySelector('button') !== null }));

const errors = [];
// A read the page cancels because it left the list (the host answers 499 `omniview:cancelled`, which its wails binding sends as an HTTP 422) is the page's own doing and not a fault: it is counted and shown, not
// mixed with the errors.
const cancelled = [];

let shown = '';
async function openKind(page, spec) {
  const nav = page.getByRole('navigation', { name: 'Kubernetes resources' });
  const item = nav.getByRole('treeitem', { name: spec.item }).first();
  if ((await item.count()) === 0) await nav.getByRole('treeitem', { name: new RegExp(`^${spec.group}(\\s|$)`) }).first().click();
  await item.click();
  // The list of another kind has other headers: the list is the new one when its headers are not the last list's (the first one is compared with none).
  await page.waitForFunction((last) => document.querySelector('[data-ov-state]')?.getAttribute('data-ov-state') === 'ready'
    && JSON.stringify([...document.querySelectorAll('table thead th')].map((th) => th.innerText.trim())) !== last
    && document.querySelectorAll('table tbody tr[data-ov-index]').length > 0, shown, { timeout: 90_000 });
  shown = JSON.stringify((await page.evaluate(HEADERS)).map((h) => h.text));
  await sleep(600);
}

/** The rows as ids and by header: `[ids, Map(id -> { header -> the words in the cell })]`. */
async function readList(page, spec, headers) {
  const rows = await page.evaluate(READ_ROWS);
  const domById = new Map();
  const ids = rows.map(({ cells }) => {
    const [first, second] = cells[0].split('\n').map((line) => line.trim()).filter(Boolean);
    const id = spec.namespaced && second !== undefined ? `${second}/${first}` : first;
    domById.set(id, Object.fromEntries(headers.map((header, column) => [header.text, cells[column]])));
    return id;
  });
  return { ids, domById, indexes: rows.map((row) => row.index) };
}

const sameOrder = (a, b) => a.length === b.length && a.every((id, index) => id === b[index]);

/** Every cell the list shows as a dash, against the cluster's Table: kubectl may print a value the plugin does not draw only where kubectl itself prints no value or a zero of nothing reported. */
function dashAudit(spec, rows, domById) {
  const violations = [];
  let count = 0;
  for (const row of rows) {
    for (const [header, column] of Object.entries(spec.columns)) {
      if (column.kind === 'time' || column.dom || !/^[—–-]?$/.test(domById.get(row.id)?.[header] ?? 'x')) continue;
      count += 1;
      const cell = row.cells[column.cell];
      const reported = column.kind === 'seconds'
        ? row.object?.status?.startTime !== undefined
        : cell !== undefined && cell !== null && String(cell) !== '' && !/^<none>$/.test(String(cell)) && !(['int', 'quantity'].includes(column.kind) && Number.parseFloat(String(cell)) === 0);
      if (reported) violations.push(`${row.id} ${header}: the list shows a dash, kubectl prints ${JSON.stringify(cell)}`);
    }
  }

  return { count, violations };
}

/** Reads the list and holds it to the rule. The cluster and the page move under a run (a crashing Pod restarts), so a difference is read again, up to three times, each against a fresh Table. */
async function check(page, proxy, spec, header, direction) {
  // `--control=reversed` is the proof's own control: it holds the page to the OPPOSITE direction, so every press whose two directions order the rows differently must fail.
  const held = args.control === 'reversed' ? (direction === 'ascending' ? 'descending' : 'ascending') : direction;
  let last;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const headers = await page.evaluate(HEADERS);
    const before = await snapshot(proxy, spec);
    const { ids, domById, indexes } = await readList(page, spec, headers);
    const after = await snapshot(proxy, spec);
    const contiguous = indexes.every((index, position) => index === position);
    for (const rows of [before, after]) {
      const problem = contiguous ? orderProblem(ids, rows, spec, header, held, domById) : { notContiguous: indexes.slice(0, 8) };
      if (problem === undefined) {
        const audit = dashAudit(spec, after, domById);
        return { ok: audit.violations.length === 0, rows: ids.length, attempt, dashes: audit.count, ...(audit.violations.length > 0 ? { violations: audit.violations.slice(0, 5) } : {}) };
      }

      last = problem;
    }

    await sleep(1500);
  }

  return { ok: false, problem: last };
}

/* ------------------------------------------------------------------------------------------------------------------------------ */

const results = [];
const note = (entry) => { results.push(entry); console.log(JSON.stringify(entry)); };

// `--fresh=true`: the host forgets the window it saved (the demo's `forgetSession`: the shell's own `SaveState`), so the page opens as a first run does, in the default sort of every list.
if (args.fresh === 'true') {
  await sleep(1500);
  const response = await fetch(`${base}/wails/runtime`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wails-client-id': 'k3a-proof' },
    body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': `k3a-proof-${Date.now()}`, methodName: 'github.com/omniviewdev/omniview/backend/window.Service.SaveState', args: ['main', 'session', 'null'] } }),
  });
  if (!response.ok) throw new Error(`the host did not forget its window: ${response.status}`);
}

const browserType = engineName === 'chromium' ? chromium : webkit;
const browser = await browserType.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('response', async (response) => {
  if (response.status() < 400) return;
  const answer = await response.text().catch(() => '');
  const entry = { kind: 'response', status: response.status(), method: response.request().method(), url: response.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 140), post: (response.request().postData() ?? '').slice(0, 1200), answer: answer.slice(0, 400) };
  (answer.includes('omniview:cancelled') ? cancelled : errors).push(entry);
});
page.on('console', (message) => { if (message.type() === 'error') errors.push({ kind: 'console', text: message.text().slice(0, 220) }); });
page.on('pageerror', (error) => errors.push({ kind: 'pageerror', text: String(error.message).slice(0, 220) }));

console.log(`engine ${engineName}, mode ${mode}, ${base}, ${execFileSync('uptime', { encoding: 'utf8' }).trim()}`);
await page.goto(`${base}/`);
// A host remembers the window of the last browser that used it: a window that was restored shows the plugin's sidebar at once; a first one lists the plugins that can be opened.
const plugins = page.getByRole('region', { name: 'Plugins you can open' });
await plugins.or(page.getByRole('navigation', { name: 'Kubernetes resources' })).first().waitFor({ timeout: 90_000 });
if ((await plugins.count()) > 0) await plugins.getByRole('button', { name: /^Kubernetes/ }).click();
// A restored window may have the Workloads group closed (the sidebar counts only the kinds on screen), so the wait is for the sidebar, not for a count.
await page.waitForFunction(() => document.querySelectorAll('nav [role=treeitem]').length >= 5, undefined, { timeout: 90_000 });
note({ step: 'theme', theme: await page.evaluate(() => document.documentElement.getAttribute('data-ov-theme')), viewport: page.viewportSize() });

const proxy = await startProxy();
try {
  if (mode === 'warm') {
    // Opens the plugin, so that its connection is started and its discovery cached, and leaves: the run that follows (with --fresh=true) is of a window that opens as a first one does.
    await sleep(4000);
  } else if (mode === 'pairing') {
    const spec = KINDS.Pods;
    await openKind(page, spec);
    const headers = await page.evaluate(HEADERS);
    const first = await readList(page, spec, headers);
    const problem = orderProblem(first.ids, await snapshot(proxy, spec), spec, 'Name', 'ascending', first.domById);
    note({ step: 'pairing: Pods list', rows: first.ids.length, headers: headers.map((h) => `${h.text}${h.button ? ' [button]' : ''}${h.sort && h.sort !== 'none' ? ` (${h.sort})` : ''}`), inDefaultOrder: problem === undefined, ...(problem === undefined ? {} : { problem }), first: first.ids.slice(0, 3) });
    const sortable = headers.findIndex((h, index) => h.button && h.text === 'Restarts' && index >= 0);
    if (sortable >= 0) {
      await page.locator('table thead th').nth(sortable).locator('button').click();
      await sleep(900);
      const after = await readList(page, spec, headers);
      note({ step: 'pairing: Restarts pressed once', aria: (await page.evaluate(HEADERS))[sortable].sort, orderChanged: !sameOrder(first.ids, after.ids), sortedByRestarts: orderProblem(after.ids, await snapshot(proxy, spec), spec, 'Restarts', 'ascending', after.domById) === undefined });
    }
  } else {
    for (const label of wanted) {
      const spec = KINDS[label];
      await openKind(page, spec);
      const headers = await page.evaluate(HEADERS);
      const sortable = headers.map((h, index) => ({ ...h, index })).filter((h) => h.button);
      note({ step: `${label}: headers`, headers: headers.map((h) => `${h.text}${h.button ? ' [sorts]' : ''}${h.sort && h.sort !== 'none' ? ` (${h.sort})` : ''}`) });
      const unknown = headers.filter((h) => h.text !== '' && spec.columns[h.text] === undefined).map((h) => h.text);
      if (unknown.length > 0) note({ step: `${label}: headers with no expectation in this proof`, unknown, ok: false });
      note({ step: `${label}: opens in the default order, Name ascending`, aria: headers.find((h) => h.text === 'Name')?.sort, ...(await check(page, proxy, spec, 'Name', 'ascending')) });
      for (const header of sortable.filter((h) => spec.columns[h.text] !== undefined)) {
        for (const press of [1, 2]) {
          const before = (await page.evaluate(HEADERS))[header.index].sort;
          const want = before === 'ascending' ? 'descending' : 'ascending';
          await page.locator('table thead th').nth(header.index).locator('button').click();
          await page.waitForFunction(([index, state]) => document.querySelectorAll('table thead th')[index]?.getAttribute('aria-sort') === state, [header.index, want], { timeout: 15_000 }).catch(() => undefined);
          await sleep(500);
          const states = (await page.evaluate(HEADERS)).filter((h) => h.sort && h.sort !== 'none').map((h) => `${h.text}:${h.sort}`);
          const result = await check(page, proxy, spec, header.text, want);
          note({ step: `${label}: ${header.text} press ${press}`, want, ariaSort: states, ...result, ok: result.ok && states.length === 1 && states[0] === `${header.text}:${want}` });
          if (label === 'Pods' && header.text === 'Restarts' && press === 2) {
            const shot = path.join(out, `pods-restarts-descending-${engineName}.png`);
            await page.screenshot({ path: shot });
            note({ step: 'screenshot', shot });
          }
        }
      }
    }

    // A live change while a sort is in force: the sort stays, and the rule holds for the rows that come, go and change. (`--live=false` leaves this phase out.)
    if (args.live !== 'false') {
      const spec = KINDS.Pods;
      await openKind(page, spec);
      const stamp = `${engineName}-${Date.now().toString(36)}`;
      const made = [];
      const waitForRows = async (names) => {
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const { ids } = await readList(page, spec, await page.evaluate(HEADERS));
          if (names.every((name) => ids.includes(`checkout/${name}`))) return;
          await sleep(1000);
        }
        throw new Error(`the list never showed ${names.join(', ')}`);
      };
      try {
        for (const [header, presses] of [['Age', 2], ['Restarts', 2]]) {
          const added = [`live-run-${stamp}-${header.toLowerCase()}`, `live-crash-${stamp}-${header.toLowerCase()}`];
          made.push(...added);
          const headers = await page.evaluate(HEADERS);
          const index = headers.findIndex((h) => h.text === header);
          for (let n = 0; n < presses; n += 1) { await page.locator('table thead th').nth(index).locator('button').click(); await sleep(400); }
          const direction = (await page.evaluate(HEADERS))[index].sort;
          note({ step: `live: ${header} is ${direction}`, ...(await check(page, proxy, spec, header, direction)) });
          kubectl('-n', 'checkout', 'run', added[0], '--image=busybox:1.37.0', '--restart=Never', '--', 'sleep', '3600');
          kubectl('-n', 'checkout', 'run', added[1], '--image=busybox:1.37.0', '--', 'sh', '-c', 'exit 1');
          await waitForRows(added);
          await sleep(4000);
          note({ step: `live: two Pods are added while ${header} is ${direction}`, direction: (await page.evaluate(HEADERS))[index].sort, ...(await check(page, proxy, spec, header, direction)) });
          kubectl('-n', 'checkout', 'scale', 'deploy/cart-api', '--replicas=5');
          await sleep(9000);
          note({ step: `live: cart-api scaled up while ${header} is ${direction}`, ...(await check(page, proxy, spec, header, direction)) });
          await sleep(45_000);
          note({ step: `live: a crashing Pod restarts while ${header} is ${direction}`, ...(await check(page, proxy, spec, header, direction)) });
          kubectl('-n', 'checkout', 'delete', 'pod', ...added, '--wait=false');
          kubectl('-n', 'checkout', 'scale', 'deploy/cart-api', '--replicas=3');
          await sleep(9000);
          note({ step: `live: Pods removed while ${header} is ${direction}`, ...(await check(page, proxy, spec, header, direction)) });
        }
      } finally {
        kubectl('-n', 'checkout', 'delete', 'pod', ...made, '--ignore-not-found', '--wait=false');
        kubectl('-n', 'checkout', 'scale', 'deploy/cart-api', '--replicas=3');
      }
    }
  }
} finally {
  proxy.stop();
  await browser.close();
}

const failed = results.filter((entry) => entry.ok === false);
// The browser says each failed load once more on the console, without saying which: one such line goes with each cancelled read.
let owed = cancelled.length;
const faults = errors.filter((entry) => !(entry.kind === 'console' && /status of 422/.test(entry.text) && owed-- > 0));
fs.writeFileSync(path.join(out, `result-${mode}-${engineName}.json`), JSON.stringify({ engine: engineName, mode, base, results, errors: faults, cancelled }, null, 2));
console.log(`\n${results.length} steps, ${failed.length} failed, ${faults.length} page errors, ${cancelled.length} cancelled reads`);
for (const entry of cancelled) console.log(`  cancelled: ${(/"methodName":"([^"]+)"/.exec(entry.post) ?? [])[1]} ${(/"type":"([^"]+)"/.exec(entry.post) ?? [])[1] ?? ''}`);
for (const error of faults) console.log(`  error: ${JSON.stringify(error)}`);
process.exit(failed.length === 0 && faults.length === 0 ? 0 : 1);
