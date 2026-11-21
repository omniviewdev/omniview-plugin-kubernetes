import { column, typeOf, type KindDefinition } from '../definition';
import { ageCell, countCell, none, ratioCell, statusCell } from '../display';

import { podRow, podRows, podSearchText, type PodRow } from './row';

// The Pod definition: the shape of the mock's definition record (docs/ui-next/slices/1a-pods-list.md 2.4; MOCK k8s-resource-definitions.js:1053-1086) with the Pods columns of PRINTER.Pod
// (:737-742). The generic list page and the data hook read it; they know no Pod rule of their own. CPU and Memory are not here (tier B, plan 1.2).

const identity = { group: '', version: 'v1', resource: 'pods' } as const;

export const podDefinition: KindDefinition<PodRow> = {
  identity,
  type: typeOf(identity),
  kind: 'Pod',
  nouns: { one: 'Pod', other: 'Pods' },
  page: 'pods',
  tile: { icon: 'box', tone: 'blue' },
  model: { row: podRow, rows: podRows, searchText: podSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('ready', 'Ready', 'fixed', 59, 'right', 'ratio'),
    column('status', 'Status', 'fixed', 157, 'left', 'text'),
    column('restarts', 'Restarts', 'fixed', 72, 'right', 'number'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
    column('node', 'Node', 'flex', 72, 'left', 'text', { defaultHidden: true }),
    column('ip', 'IP', 'fixed', 113, 'left', 'text', { defaultHidden: true }),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: (row) => row.nameTail },
    // Counted over the rows after search and facets, before the chosen filter (plan 1.3). Running is the word, Pending and Failed are roles.
    quickFilters: [
      { id: 'running', label: 'Running', tone: 'success', test: (row) => row.status?.word === 'Running' },
      { id: 'pending', label: 'Pending', tone: 'warning', test: (row) => row.status?.role === 'progress' },
      { id: 'failed', label: 'Failed', tone: 'error', test: (row) => row.status?.role === 'error' },
      { id: 'completed', label: 'Completed', tone: 'muted', test: (row) => row.status?.word === 'Completed' || row.status?.word === 'Succeeded' },
    ],
    facets: [{ id: 'node', label: 'Node', all: 'All nodes', value: (row) => row.node }],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'ready', sortValue: (row) => row.ready, display: ({ ready }) => ratioCell(ready, 'The Pod lists no containers.') },
    { id: 'status', sortValue: (row) => row.status?.word, display: ({ status }) => statusCell(status, 'The Pod reports no phase.') },
    { id: 'restarts', sortValue: (row) => row.restarts, display: ({ restarts }) => countCell(restarts, 'No container has reported a restart count yet.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The Pod has no creation time.') },
    { id: 'node', sortValue: (row) => row.node, display: ({ node }) => (node === undefined ? none('Not scheduled to a node yet.') : { kind: 'text', text: node }) },
    { id: 'ip', sortValue: (row) => row.ip, display: ({ ip }) => (ip === undefined ? none('No address assigned yet.') : { kind: 'text', text: ip, mono: true }) },
  ],
  // The Pod's page (`ui/src/pod/`), which is the plugin's own and not the generic one: it has no overview here. A row with no namespace has no identity to open.
  detail: { page: 'pod', identity: ['namespace', 'name'] },
};
