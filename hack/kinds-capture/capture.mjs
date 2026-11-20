#!/usr/bin/env node
// Captures the golden fixtures of the workload lists (ui/src/kinds/<kind>/fixtures/<kind>-table.json) from a real API server: for each kind, ONE response of
//
//   GET <collection path>?includeObject=Object      Accept: application/json;as=Table;g=meta.k8s.io;v=v1
//
// which is what `kubectl get <kind> -A` asks for and prints from: the Table's rows hold the object and the cells the server printed for it, taken together, so the test
// compares the row model with the oracle on the same bytes. `metadata.managedFields` is removed (nothing reads it; it is most of an object's size). The response's Date
// header is kept as `serverDate`: the clock the server printed AGE and DURATION against.
//
//   [ONLY=nodes,secrets] [APPEND=1] node hack/kinds-capture/capture.mjs <kubeconfig> <output directory> [label]
//
// The cluster is the one `docs/ui-next/slices/1a-pods-list/fixture.yaml` of omniview, `extra-states.yaml` and `more-kinds.yaml` of this directory make (the header of the first of those
// says how, and `more-kinds.sh` does the second). Only the kubeconfig named on the command line is read, never the ambient one: this script talks to the API server through
// `kubectl proxy` with it and to nothing else.
//
//   ONLY    the directories to capture, comma separated: the other fixtures are left as they are (default: every kind below)
//   APPEND  add this capture to the `captures` of the fixture that is there, under its own label, instead of replacing the file: a kind whose states are made by changing the cluster
//           (a Node that is cordoned, a Node whose kubelet has stopped) is one fixture with one capture of each
//
// A Secret is captured WITHOUT its values: every `data` value is empty, `stringData` is dropped and so is every annotation's value (one of them, `last-applied-configuration`, can hold
// the values whole). The lists read a Secret's type and the number of its keys and never a value, so no fixture needs one, and none may carry one. A ConfigMap value that is a signed
// token (the `jws-kubeconfig-*` key kubeadm writes into kube-public/cluster-info) is replaced by as many `x` as it has bytes: the list reads the size of a value, so the size stays.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [kubeconfig, outDirectory, label = 'one read of a cluster that holds the slice fixture and the extra states'] = process.argv.slice(2);
if (kubeconfig === undefined || outDirectory === undefined) {
  console.error('usage: capture.mjs <kubeconfig> <output directory> [label]');
  process.exit(2);
}

const ALL_KINDS = [
  { directory: 'deployments', path: '/apis/apps/v1/deployments' },
  { directory: 'statefulsets', path: '/apis/apps/v1/statefulsets' },
  { directory: 'daemonsets', path: '/apis/apps/v1/daemonsets' },
  { directory: 'jobs', path: '/apis/batch/v1/jobs' },
  { directory: 'replicasets', path: '/apis/apps/v1/replicasets' },
  { directory: 'cronjobs', path: '/apis/batch/v1/cronjobs' },
  { directory: 'configmaps', path: '/api/v1/configmaps' },
  { directory: 'secrets', path: '/api/v1/secrets' },
  { directory: 'services', path: '/api/v1/services' },
  { directory: 'ingresses', path: '/apis/networking.k8s.io/v1/ingresses' },
  { directory: 'namespaces', path: '/api/v1/namespaces' },
  { directory: 'nodes', path: '/api/v1/nodes' },
];
const only = process.env.ONLY === undefined ? undefined : new Set(process.env.ONLY.split(','));
const KINDS = only === undefined ? ALL_KINDS : ALL_KINDS.filter((kind) => only.has(kind.directory));
if (KINDS.length === 0) {
  console.error(`ONLY names no kind: ${ALL_KINDS.map((kind) => kind.directory).join(', ')}`);
  process.exit(2);
}

const SIGNED_TOKEN = /^eyJ[\w-]+\.[\w-]*\.[\w-]+$/;

/** The object as a fixture keeps it: no managedFields (most of an object's size, read by nothing), no value anywhere for a Secret and no signed token in a ConfigMap (see the header). */
function kept(object) {
  const { managedFields: _, ...metadata } = object.metadata;
  if (object.kind === 'ConfigMap') {
    const masked = Object.fromEntries(Object.entries(object.data ?? {}).map(([key, value]) => [key, SIGNED_TOKEN.test(value) ? 'x'.repeat(Buffer.byteLength(value)) : value]));
    return { ...object, metadata, ...(object.data === undefined ? {} : { data: masked }) };
  }

  if (object.kind !== 'Secret') {
    return { ...object, metadata };
  }

  const { stringData: __, ...rest } = object;
  const emptied = (map) => Object.fromEntries(Object.keys(map ?? {}).map((key) => [key, '']));
  return {
    ...rest,
    metadata: metadata.annotations === undefined ? metadata : { ...metadata, annotations: emptied(metadata.annotations) },
    ...(object.data === undefined ? {} : { data: emptied(object.data) }),
  };
}

/** The fixture file: one row per line, so a review reads a row as one object and a re-capture shows as the rows that changed. */
function render(source, captures) {
  return [
    '{',
    `  "source": ${JSON.stringify(source)},`,
    '  "captures": [',
    captures
      .map((capture) => [
        '    {',
        `      "label": ${JSON.stringify(capture.label)},`,
        `      "serverDate": ${JSON.stringify(capture.serverDate)},`,
        `      "columns": ${JSON.stringify(capture.columns)},`,
        `      "priorities": ${JSON.stringify(capture.priorities)},`,
        '      "rows": [',
        capture.rows.map((row) => `        ${JSON.stringify(row)}`).join(',\n'),
        '      ]',
        '    }',
      ].join('\n'))
      .join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}

const proxy = spawn('kubectl', ['--kubeconfig', kubeconfig, 'proxy', '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
const base = await new Promise((resolve, reject) => {
  proxy.stdout.once('data', (chunk) => {
    const found = /127\.0\.0\.1:(\d+)/.exec(String(chunk));
    found === null ? reject(new Error(`kubectl proxy said: ${String(chunk)}`)) : resolve(`http://127.0.0.1:${found[1]}`);
  });
  proxy.once('exit', (code) => reject(new Error(`kubectl proxy exited with ${String(code)}`)));
});

try {
  const version = await (await fetch(`${base}/version`)).json();
  for (const kind of KINDS) {
    const response = await fetch(`${base}${kind.path}?includeObject=Object`, { headers: { Accept: 'application/json;as=Table;g=meta.k8s.io;v=v1' } });
    if (!response.ok) {
      throw new Error(`${kind.path}: ${String(response.status)}`);
    }
    const table = await response.json();
    if (table.kind !== 'Table') {
      throw new Error(`${kind.path}: the server answered a ${String(table.kind)}, not a Table`);
    }
    const capture = {
      label,
      serverDate: response.headers.get('date'),
      columns: table.columnDefinitions.map((column) => column.name),
      priorities: table.columnDefinitions.map((column) => column.priority),
      rows: table.rows.map((row) => ({ cells: row.cells, object: kept(row.object) })),
    };
    const rows = capture.rows;
    const source = `kube-apiserver ${version.gitVersion}, GET ${kind.path}?includeObject=Object with Accept application/json;as=Table;g=meta.k8s.io;v=v1: the object and the printer cells of one response. managedFields removed${kind.directory === 'secrets' ? ', and no Secret value kept' : ''}. Made by hack/kinds-capture/capture.mjs.`;
    const directory = path.join(outDirectory, kind.directory, 'fixtures');
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, `${kind.directory}-table.json`);
    const before = process.env.APPEND === undefined ? [] : JSON.parse(await readFile(file, 'utf8')).captures;
    await writeFile(file, render(source, [...before, capture]));
    console.log(`${kind.directory}: ${String(rows.length)} rows, columns ${table.columnDefinitions.map((column) => `${column.name}(${String(column.priority)})`).join(' ')}`);
  }
} finally {
  proxy.kill('SIGTERM');
}
