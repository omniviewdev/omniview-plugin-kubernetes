#!/usr/bin/env node
// Captures the golden fixtures of the workload lists (ui/src/kinds/<kind>/fixtures/<kind>-table.json) from a real API server: for each kind, ONE response of
//
//   GET <collection path>?includeObject=Object      Accept: application/json;as=Table;g=meta.k8s.io;v=v1
//
// which is what `kubectl get <kind> -A` asks for and prints from: the Table's rows hold the object and the cells the server printed for it, taken together, so the test
// compares the row model with the oracle on the same bytes. `metadata.managedFields` is removed (nothing reads it; it is most of an object's size). The response's Date
// header is kept as `serverDate`: the clock the server printed AGE and DURATION against.
//
//   node hack/kinds-capture/capture.mjs <kubeconfig> <output directory> [label]
//
// The cluster is the one `docs/ui-next/slices/1a-pods-list/fixture.yaml` of omniview and `extra-states.yaml` of this directory make (the header of that file says how). Only the
// kubeconfig named on the command line is read, never the ambient one: this script talks to the API server through `kubectl proxy` with it and to nothing else.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [kubeconfig, outDirectory, label = 'one read of a cluster that holds the slice fixture and the extra states'] = process.argv.slice(2);
if (kubeconfig === undefined || outDirectory === undefined) {
  console.error('usage: capture.mjs <kubeconfig> <output directory> [label]');
  process.exit(2);
}

const KINDS = [
  { directory: 'deployments', path: '/apis/apps/v1/deployments' },
  { directory: 'statefulsets', path: '/apis/apps/v1/statefulsets' },
  { directory: 'daemonsets', path: '/apis/apps/v1/daemonsets' },
  { directory: 'jobs', path: '/apis/batch/v1/jobs' },
];

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
    const rows = table.rows.map((row) => {
      const { managedFields: _, ...metadata } = row.object.metadata;
      return { cells: row.cells, object: { ...row.object, metadata } };
    });
    // One row per line: a review reads a row as one object, and a re-capture shows as the rows that changed.
    const body = [
      '{',
      `  "source": ${JSON.stringify(`kube-apiserver ${version.gitVersion}, GET ${kind.path}?includeObject=Object with Accept application/json;as=Table;g=meta.k8s.io;v=v1: the object and the printer cells of one response. managedFields removed. Made by hack/kinds-capture/capture.mjs.`)},`,
      '  "captures": [',
      '    {',
      `      "label": ${JSON.stringify(label)},`,
      `      "serverDate": ${JSON.stringify(response.headers.get('date'))},`,
      `      "columns": ${JSON.stringify(table.columnDefinitions.map((column) => column.name))},`,
      `      "priorities": ${JSON.stringify(table.columnDefinitions.map((column) => column.priority))},`,
      '      "rows": [',
      rows.map((row) => `        ${JSON.stringify(row)}`).join(',\n'),
      '      ]',
      '    }',
      '  ]',
      '}',
      '',
    ].join('\n');
    const directory = path.join(outDirectory, kind.directory, 'fixtures');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${kind.directory}-table.json`), body);
    console.log(`${kind.directory}: ${String(rows.length)} rows, columns ${table.columnDefinitions.map((column) => `${column.name}(${String(column.priority)})`).join(' ')}`);
  }
} finally {
  proxy.kill('SIGTERM');
}
