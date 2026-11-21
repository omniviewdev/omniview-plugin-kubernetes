#!/usr/bin/env node
// Captures the golden fixtures of the detail pages (ui/src/kinds/<kind>/fixtures/<kind>-detail.json) from a real API server: for each kind, every object of the cluster as `kubectl get <kind> -A -o json` prints
// it, and, next to each, what `kubectl describe` prints of it. The detail pages' Details rows are held to the first (the object, field for field, as the kind's definition maps it) and, where a row is a
// derived value (a strategy in words, a selector, a claim retention policy), to the second. `metadata.managedFields` is removed (nothing reads it; it is most of an object's size). The Date header
// of the answer is kept as `serverDate`: the clock the cluster printed AGE against.
//
//   [ONLY=nodes,configmaps] node hack/kinds-capture/capture-detail.mjs <kubeconfig> <output directory>
//
// The cluster is the one `docs/ui-next/slices/1a-pods-list/fixture.yaml` of omniview, `extra-states.yaml`, `more-kinds.yaml`, `k2b2-kinds.yaml` and `k2c1-kinds.yaml` of this directory make (the header of the
// first of those says how, and `more-kinds.sh`, `k2b2-kinds.sh` and `k2c1-kinds.sh` do the others). Only the kubeconfig named on the command line is read, never the ambient one.
//
//   ONLY    the directories to capture, comma separated: the other fixtures are left as they are (default: the nine kinds of the first batch)
//
// A ConfigMap fixture keeps the objects of the namespaces `detail` and `more` only (the others hold certificates and tokens a page does not need), without `describe` (it prints every value), and a signed
// token among the values, or in its last applied configuration (which holds the whole manifest, values included), is replaced by as many `x` as it has bytes (`kept.mjs`). A Node's `describe` is cut where it
// starts to list the Pods of the Node: what the page says of a Node is above that.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { kept } from './kept.mjs';
import { run } from './run.mjs';

const [kubeconfig, outDirectory] = process.argv.slice(2);
if (kubeconfig === undefined || outDirectory === undefined) {
  console.error('usage: capture-detail.mjs <kubeconfig> <output directory>');
  process.exit(2);
}

const ALL_KINDS = [
  { directory: 'deployments', resource: 'deployments.apps', describe: true },
  { directory: 'statefulsets', resource: 'statefulsets.apps', describe: true },
  { directory: 'daemonsets', resource: 'daemonsets.apps', describe: true },
  { directory: 'jobs', resource: 'jobs.batch', describe: true },
  { directory: 'cronjobs', resource: 'cronjobs.batch', describe: true },
  { directory: 'services', resource: 'services', describe: true },
  { directory: 'configmaps', resource: 'configmaps', describe: false, namespaces: ['detail', 'more'] },
  { directory: 'namespaces', resource: 'namespaces', describe: true },
  { directory: 'nodes', resource: 'nodes', describe: true, cutDescribeAt: 'Non-terminated Pods:' },
];
const only = process.env.ONLY === undefined ? undefined : new Set(process.env.ONLY.split(','));
const KINDS = only === undefined ? ALL_KINDS : ALL_KINDS.filter((kind) => only.has(kind.directory));
if (KINDS.length === 0) {
  console.error(`ONLY names no kind: ${ALL_KINDS.map((kind) => kind.directory).join(', ')}`);
  process.exit(2);
}

/** The fixture file: one object per line, so a review reads an object as one line and a re-capture shows as the objects that changed. */
function render(source, serverDate, objects) {
  return [
    '{',
    `  "source": ${JSON.stringify(source)},`,
    `  "serverDate": ${JSON.stringify(serverDate)},`,
    '  "objects": [',
    objects.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}

const version = JSON.parse(await run('kubectl', ['--kubeconfig', kubeconfig, 'version', '-o', 'json'])).serverVersion.gitVersion;
const serverDate = new Date().toUTCString();
for (const kind of KINDS) {
  const list = JSON.parse(await run('kubectl', ['--kubeconfig', kubeconfig, 'get', kind.resource, '-A', '-o', 'json']));
  const items = list.items.filter((object) => kind.namespaces === undefined || kind.namespaces.includes(object.metadata.namespace));
  const objects = [];
  for (const item of items) {
    const entry = { object: kept(item) };
    if (kind.describe) {
      const namespace = item.metadata.namespace === undefined ? [] : ['-n', item.metadata.namespace];
      let described = await run('kubectl', ['--kubeconfig', kubeconfig, 'describe', kind.resource, ...namespace, item.metadata.name]);
      if (kind.cutDescribeAt !== undefined && described.includes(kind.cutDescribeAt)) {
        described = described.slice(0, described.indexOf(kind.cutDescribeAt));
      }
      entry.describe = described.trimEnd();
    }
    objects.push(entry);
  }

  const source = `kube-apiserver ${version}: every object of the cluster as \`kubectl get ${kind.resource} -A -o json\` prints it${kind.describe ? ', and what `kubectl describe` prints of it' : ''}. managedFields removed. Made by hack/kinds-capture/capture-detail.mjs.`;
  const directory = path.join(outDirectory, kind.directory, 'fixtures');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${kind.directory}-detail.json`);
  await writeFile(file, render(source, serverDate, objects));
  console.log(`${file}: ${String(objects.length)} objects`);
}
