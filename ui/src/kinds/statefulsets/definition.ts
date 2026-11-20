import { column, typeOf, type KindDefinition } from '../definition';
import { ageCell, none, statusCell, watchedRatioCell } from '../display';

import { statefulSetRow, statefulSetRows, statefulSetSearchText, type StatefulSetRow } from './row';

// The StatefulSet definition, as the mock's `PRINTER.StatefulSet` has it (MOCK k8s-resource-definitions.js:759-763; ch17 K60.3): after the name, Status, Ready, Service and Age. The wide set (Images)
// and the Columns chooser's wait for the list page to have them. The mock keeps no tail on a StatefulSet's name: its Pods carry the ordinals, not it.

const identity = { group: 'apps', version: 'v1', resource: 'statefulsets' } as const;

export const statefulSetDefinition: KindDefinition<StatefulSetRow> = {
  identity,
  type: typeOf(identity),
  kind: 'StatefulSet',
  nouns: { one: 'StatefulSet', other: 'StatefulSets' },
  page: 'statefulsets',
  tile: { icon: 'list-ordered', tone: 'blue' },
  model: { row: statefulSetRow, rows: statefulSetRows, searchText: statefulSetSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    // 150 px holds the longest state word of the rule, `Partially ready`, with its glyph (the mock's worksheet: 7.2 px a character plus 42).
    column('status', 'Status', 'fixed', 150, 'left', 'text'),
    column('ready', 'Ready', 'fixed', 59, 'right', 'ratio'),
    column('service', 'Service', 'flex', 72, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    // The kind's own split of its state words (MOCK `bar`): Scaled to zero is in All and in no filter.
    quickFilters: [
      { id: 'available', label: 'Available', tone: 'success', test: (row) => row.status?.word === 'Available' },
      { id: 'progressing', label: 'Progressing', tone: 'info', test: (row) => row.status?.word === 'Progressing' },
      { id: 'partial', label: 'Partially ready', tone: 'warning', test: (row) => row.status?.word === 'Partially ready' },
      { id: 'unavailable', label: 'Unavailable', tone: 'error', test: (row) => row.status?.word === 'Unavailable' },
    ],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'status', sortValue: (row) => row.status?.word, display: ({ status }) => statusCell(status, 'The StatefulSet states no replica count.') },
    { id: 'ready', sortValue: (row) => row.ready, display: ({ ready }) => watchedRatioCell(ready, 'The StatefulSet states no replica count.') },
    { id: 'service', sortValue: (row) => row.service, display: ({ service }) => (service === undefined ? none('The StatefulSet names no governing Service.') : { kind: 'text', text: service }) },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The StatefulSet has no creation time.') },
  ],
};
