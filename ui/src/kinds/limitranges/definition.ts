import { GENERIC_TILE, column, typeOf, type KindDefinition } from '../definition';
import { ageCell, countCell, namesCell } from '../display';

import { limitRangeRow, limitRangeRows, limitRangeSearchText, type LimitRangeRow } from './row';

// The LimitRange definition, as the mock's `PRINTER.LimitRange` has it (MOCK k8s-resource-definitions.js:807; ch17 K60.1 and K60.3): after the name, Items (the mock's `limitsCount`: the entries of
// `spec.limits`), Types (its `scopes`: the type of each entry) and Age. kubectl prints only a name and the time the object was made, so the mock names the first two itself. The mock has no quick
// filters for the kind, and no other column: what a Container may use is in its detail.

const identity = { group: '', version: 'v1', resource: 'limitranges' } as const;

export const limitRangeDefinition: KindDefinition<LimitRangeRow> = {
  identity,
  type: typeOf(identity),
  kind: 'LimitRange',
  nouns: { one: 'LimitRange', other: 'LimitRanges' },
  page: 'limitranges',
  // The mock's glyph is a ruler (Lucide `Ruler`), which the kit's registry does not have yet: the generic tile stands for it.
  tile: GENERIC_TILE,
  model: { row: limitRangeRow, rows: limitRangeRows, searchText: limitRangeSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('items', 'Items', 'fixed', 54, 'right', 'number'),
    column('types', 'Types', 'flex', 72, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'items', sortValue: (row) => row.items, display: ({ items }) => countCell(items, 'The LimitRange states no limits.') },
    // The first three types and the number of the rest, as the mock's `listText` with `max: 3`; the whole list is the tip.
    { id: 'types', sortValue: (row) => row.types?.join(', '), display: ({ types }) => namesCell(types, 3, 'The LimitRange names no types.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The LimitRange has no creation time.') },
  ],
};
