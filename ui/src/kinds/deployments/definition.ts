import { column, typeOf, type KindDefinition } from '../definition';
import { ageCell, countCell, statusCell, watchedRatioCell } from '../display';

import { deploymentRow, deploymentRows, deploymentSearchText, type DeploymentRow } from './row';

// The Deployment definition, as the mock's `PRINTER.Deployment` has it (MOCK k8s-resource-definitions.js:745-749; ch17 K60.3): after the name, Status, Ready, Up-to-date and Age. The wide set
// (Available, Images) and the Columns chooser's (Containers, Selector, Strategy, ...) wait for the list page to have them. The mock keeps no tail on a Deployment's name: it is not generated.

const identity = { group: 'apps', version: 'v1', resource: 'deployments' } as const;

export const deploymentDefinition: KindDefinition<DeploymentRow> = {
  identity,
  type: typeOf(identity),
  kind: 'Deployment',
  nouns: { one: 'Deployment', other: 'Deployments' },
  page: 'deployments',
  tile: { icon: 'rocket', tone: 'blue' },
  model: { row: deploymentRow, rows: deploymentRows, searchText: deploymentSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    // 150 px holds the longest state word of the rule, `Partially ready`, with its glyph (the mock's worksheet: 7.2 px a character plus 42).
    column('status', 'Status', 'fixed', 150, 'left', 'text'),
    column('ready', 'Ready', 'fixed', 59, 'right', 'ratio'),
    column('updated', 'Up-to-date', 'fixed', 90, 'right', 'number'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    // The kind's own split of its state words (MOCK `bar`): Scaled to zero and Paused are in All and in no filter.
    quickFilters: [
      { id: 'available', label: 'Available', tone: 'success', test: (row) => row.status?.word === 'Available' },
      { id: 'progressing', label: 'Progressing', tone: 'info', test: (row) => row.status?.word === 'Progressing' },
      { id: 'partial', label: 'Partially ready', tone: 'warning', test: (row) => row.status?.word === 'Partially ready' },
      { id: 'unavailable', label: 'Unavailable', tone: 'error', test: (row) => row.status?.word === 'Unavailable' },
    ],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'status', sortValue: (row) => row.status?.word, display: ({ status }) => statusCell(status, 'The Deployment states no replica count.') },
    { id: 'ready', sortValue: (row) => row.ready, display: ({ ready }) => watchedRatioCell(ready, 'The Deployment states no replica count.') },
    { id: 'updated', sortValue: (row) => row.updated, display: ({ updated }) => countCell(updated, 'The Deployment states no replica count.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The Deployment has no creation time.') },
  ],
};
