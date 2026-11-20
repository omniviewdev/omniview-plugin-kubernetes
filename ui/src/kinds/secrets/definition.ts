import { GENERIC_TILE, column, typeOf, type KindDefinition } from '../definition';
import { ageCell, countCell, textCell } from '../display';

import { secretRow, secretRows, secretSearchText, type SecretRow } from './row';

// The Secret definition, as the mock's `PRINTER.Secret` has it (MOCK k8s-resource-definitions.js:738; ch17 K60.3): kubectl prints a name, TYPE, DATA and an age, so the list shows Type, Keys (DATA, the
// mock's word) and Age after the name. What a Secret holds is never read and never shown here: the list knows its name, its type and how many keys it has (`./object.ts`). The mock has no quick
// filters for it (it has a Type facet, which the list page does not draw yet), and the Columns chooser's (Immutable) waits for the list page to have it.

const identity = { group: '', version: 'v1', resource: 'secrets' } as const;

export const secretDefinition: KindDefinition<SecretRow> = {
  identity,
  type: typeOf(identity),
  kind: 'Secret',
  nouns: { one: 'Secret', other: 'Secrets' },
  page: 'secrets',
  // The mock's glyph is a round key (Lucide `KeyRound`), which the kit's registry does not have yet: the generic tile stands for it.
  tile: GENERIC_TILE,
  model: { row: secretRow, rows: secretRows, searchText: secretSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('type', 'Type', 'flex', 72, 'left', 'text'),
    column('keys', 'Keys', 'fixed', 50, 'right', 'number'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'type', sortValue: (row) => row.type, display: ({ type }) => textCell(type, 'The Secret states no type.') },
    { id: 'keys', sortValue: (row) => row.keys, display: ({ keys }) => countCell(keys, 'The Secret\'s keys could not be read.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The Secret has no creation time.') },
  ],
};
