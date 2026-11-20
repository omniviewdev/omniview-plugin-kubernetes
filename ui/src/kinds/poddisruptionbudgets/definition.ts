import { column, typeOf, type KindDefinition } from '../definition';
import { ageCell, countCell } from '../display';

import { podDisruptionBudgetRow, podDisruptionBudgetRows, podDisruptionBudgetSearchText, type PodDisruptionBudgetRow } from './row';

// The PodDisruptionBudget definition, as the mock's `PRINTER.PodDisruptionBudget` has it (MOCK k8s-resource-definitions.js:812; ch17 K60.3): after the name, Allowed disruptions and Age. The wide set (Min
// available, Max unavailable: the columns the mock shows only while its box has room) and the Columns chooser's (Healthy, Desired healthy, Expected Pods) wait for the list page to have them: the list
// contract has no wide set yet, so they are not drawn. The mock has no quick filters for the kind.

const identity = { group: 'policy', version: 'v1', resource: 'poddisruptionbudgets' } as const;

export const podDisruptionBudgetDefinition: KindDefinition<PodDisruptionBudgetRow> = {
  identity,
  type: typeOf(identity),
  kind: 'PodDisruptionBudget',
  nouns: { one: 'PodDisruptionBudget', other: 'PodDisruptionBudgets' },
  page: 'poddisruptionbudgets',
  tile: { icon: 'umbrella', tone: 'blue' },
  model: { row: podDisruptionBudgetRow, rows: podDisruptionBudgetRows, searchText: podDisruptionBudgetSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('allowed', 'Allowed disruptions', 'fixed', 141, 'right', 'number'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'allowed', sortValue: (row) => row.allowed, display: ({ allowed }) => countCell(allowed, 'The budget has no status yet.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The PodDisruptionBudget has no creation time.') },
  ],
};
