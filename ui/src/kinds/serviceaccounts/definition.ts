import { GENERIC_TILE, column, typeOf, type KindDefinition } from '../definition';
import { ageCell, countCell } from '../display';

import { serviceAccountRow, serviceAccountRows, serviceAccountSearchText, type ServiceAccountRow } from './row';

// The ServiceAccount definition, as the mock's `PRINTER.ServiceAccount` has it (MOCK k8s-resource-definitions.js:845; ch17 K60.1 and K60.3): kubectl prints a name and an age only, so the list gets the next
// most useful column, Secrets, after the name, and Age. The mock has no quick filters for it, and its Automount token column waits for the Columns chooser.

const identity = { group: '', version: 'v1', resource: 'serviceaccounts' } as const;

export const serviceAccountDefinition: KindDefinition<ServiceAccountRow> = {
  identity,
  type: typeOf(identity),
  kind: 'ServiceAccount',
  nouns: { one: 'ServiceAccount', other: 'ServiceAccounts' },
  page: 'serviceaccounts',
  // The mock's glyph is a person with a cog (Lucide `user-cog`), which the kit's registry does not have yet: the generic tile stands for it.
  tile: GENERIC_TILE,
  model: { row: serviceAccountRow, rows: serviceAccountRows, searchText: serviceAccountSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('secrets', 'Secrets', 'fixed', 67, 'right', 'number'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'secrets', sortValue: (row) => row.secrets, display: ({ secrets }) => countCell(secrets, 'The ServiceAccount\'s secrets could not be read.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The ServiceAccount has no creation time.') },
  ],
};
