import { column, typeOf, type Cell, type KindDefinition } from '../definition';
import { ageCell, none, statusCell } from '../display';

import { nodeCommands, nodeOverview } from './detail';
import { nodeRow, nodeRows, nodeSearchText, type NodeRow } from './row';

// The Node definition, as the mock's `PRINTER.Node` has it (MOCK k8s-resource-definitions.js:795-802; ch17 K60.3): after the name, Status, Version, CPU and Age. CPU is a usage, which needs a metrics source
// this plugin's contract has no read for yet: it is not drawn, and no zero stands for it. The wide set (Memory, also a usage) and the Columns chooser's (Roles, addresses, OS image, ...) wait for the list
// page to have them. A Node lives in no namespace: its read has no namespace in it, and under its name the mock says its address.

const identity = { group: '', version: 'v1', resource: 'nodes' } as const;

/** The kubelet version as the mock says it: three numbers (`v1.31.4`), with the whole version in the tip when it says more (`v1.31.4-eks-aeac579`). */
function versionCell({ version }: NodeRow): Cell {
  if (version === undefined) {
    return none('The Node reports no version yet.');
  }

  const short = /^v?\d+\.\d+\.\d+/.exec(version)?.[0];
  return short === undefined || short === version ? { kind: 'text', text: version } : { kind: 'text', text: short, tip: version };
}

export const nodeDefinition: KindDefinition<NodeRow> = {
  identity,
  type: typeOf(identity),
  kind: 'Node',
  nouns: { one: 'Node', other: 'Nodes' },
  page: 'nodes',
  tile: { icon: 'server', tone: 'blue' },
  model: { row: nodeRow, rows: nodeRows, searchText: nodeSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    // 179 px holds the longest state word of a Node, `Scheduling disabled`, with its glyph (the mock's worksheet: 7.2 px a character plus 42).
    column('status', 'Status', 'fixed', 179, 'left', 'text'),
    column('version', 'Version', 'fixed', 80, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => row.address ?? null, line: 'address', tail: () => 0 },
    // The kind's own split of its state words (MOCK `bar`): Unknown is in All and in no filter.
    quickFilters: [
      { id: 'ready', label: 'Ready', tone: 'success', test: (row) => row.status?.word === 'Ready' },
      { id: 'notready', label: 'NotReady', tone: 'error', test: (row) => row.status?.word === 'NotReady' },
      { id: 'cordoned', label: 'Scheduling disabled', tone: 'muted', test: (row) => row.status?.word === 'Scheduling disabled' },
    ],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'status', sortValue: (row) => row.status?.word, display: ({ status }) => statusCell(status, 'The Node reports no status yet.') },
    { id: 'version', sortValue: (row) => row.version, display: versionCell },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The Node has no creation time.') },
  ],
  // The page of one Node (`./detail.ts`), drawn by the generic detail page. It lives in no namespace: its route is its name.
  detail: { page: 'node', identity: ['name'], overview: nodeOverview, commands: nodeCommands },
};
