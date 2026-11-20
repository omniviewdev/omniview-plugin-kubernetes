import { column, typeOf, type KindDefinition } from '../definition';
import { ageCell, countCell, statusCell } from '../display';

import { replicaSetRow, replicaSetRows, replicaSetSearchText, type ReplicaSetRow } from './row';

// The ReplicaSet definition, as the mock's `PRINTER.ReplicaSet` has it (MOCK k8s-resource-definitions.js:754-757; ch17 K60.3): after the name, Status, Desired, Current, Ready and Age. The mock has no
// quick filters for it (it has a state, but no `quick`). The wide set (Images) and the Columns chooser's (Containers, Owner, ...) wait for the list page to have them. A ReplicaSet's name is
// generated (the hash of its Deployment's template), so the end of it stays whole when it is cut.

const identity = { group: 'apps', version: 'v1', resource: 'replicasets' } as const;

const NO_COUNT = 'The ReplicaSet states no replica count.';

export const replicaSetDefinition: KindDefinition<ReplicaSetRow> = {
  identity,
  type: typeOf(identity),
  kind: 'ReplicaSet',
  nouns: { one: 'ReplicaSet', other: 'ReplicaSets' },
  page: 'replicasets',
  tile: { icon: 'copy', tone: 'blue' },
  model: { row: replicaSetRow, rows: replicaSetRows, searchText: replicaSetSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    // 150 px holds the longest state word of the rule, `Partially ready`, with its glyph (the mock's worksheet: 7.2 px a character plus 42).
    column('status', 'Status', 'fixed', 150, 'left', 'text'),
    column('desired', 'Desired', 'fixed', 68, 'right', 'number'),
    column('current', 'Current', 'fixed', 67, 'right', 'number'),
    column('ready', 'Ready', 'fixed', 59, 'right', 'number'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: (row) => row.nameTail },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'status', sortValue: (row) => row.status?.word, display: ({ status }) => statusCell(status, NO_COUNT) },
    { id: 'desired', sortValue: (row) => row.desired, display: ({ desired }) => countCell(desired, NO_COUNT) },
    { id: 'current', sortValue: (row) => row.current, display: ({ current }) => countCell(current, NO_COUNT) },
    { id: 'ready', sortValue: (row) => row.ready, display: ({ ready }) => countCell(ready, NO_COUNT) },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The ReplicaSet has no creation time.') },
  ],
};
