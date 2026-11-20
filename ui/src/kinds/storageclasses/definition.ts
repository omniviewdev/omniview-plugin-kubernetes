import { GENERIC_TILE, column, typeOf, type KindDefinition } from '../definition';
import { ageCell, flagCell, textCell } from '../display';

import { storageClassRow, storageClassRows, storageClassSearchText, type StorageClassRow } from './row';

// The StorageClass definition, as the mock's `PRINTER.StorageClass` has it (MOCK k8s-resource-definitions.js:834-837; ch17 K60.3): after the name, Provisioner, Reclaim policy, Binding mode, Expansion and Age.
// The Columns chooser's (Default, Mount options) wait for the list page to have them. A StorageClass lives in no namespace and has no state, so it shows none, and the mock has no quick filters for it.

const identity = { group: 'storage.k8s.io', version: 'v1', resource: 'storageclasses' } as const;

export const storageClassDefinition: KindDefinition<StorageClassRow> = {
  identity,
  type: typeOf(identity),
  kind: 'StorageClass',
  nouns: { one: 'StorageClass', other: 'StorageClasses' },
  page: 'storageclasses',
  // The mock's glyph is Lucide `archive`, which the kit's registry does not have yet: the generic tile stands for it.
  tile: GENERIC_TILE,
  model: { row: storageClassRow, rows: storageClassRows, searchText: storageClassSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('provisioner', 'Provisioner', 'flex', 72, 'left', 'text'),
    column('reclaimPolicy', 'Reclaim policy', 'flex', 72, 'left', 'text'),
    column('binding', 'Binding mode', 'flex', 72, 'left', 'text'),
    column('expansion', 'Expansion', 'fixed', 97, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: () => null, tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'provisioner', sortValue: (row) => row.provisioner, display: ({ provisioner }) => textCell(provisioner, 'The StorageClass states no provisioner.') },
    { id: 'reclaimPolicy', sortValue: (row) => row.reclaimPolicy, display: ({ reclaimPolicy }) => textCell(reclaimPolicy, 'The StorageClass states no reclaim policy.') },
    { id: 'binding', sortValue: (row) => row.binding, display: ({ binding }) => textCell(binding, 'The StorageClass states no volume binding mode.') },
    // Yes or No as the mock says it; the sort is by those words.
    {
      id: 'expansion',
      sortValue: (row) => (row.expansion === undefined ? undefined : row.expansion ? 'Yes' : 'No'),
      display: ({ expansion }) => flagCell(expansion, 'The StorageClass cannot be read.'),
    },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The StorageClass has no creation time.') },
  ],
};
