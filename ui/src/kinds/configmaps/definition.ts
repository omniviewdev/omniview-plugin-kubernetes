import { column, typeOf, type KindDefinition } from '../definition';
import { ageCell, countCell, namesCell, textCell } from '../display';
import { bytesText } from '../fields';

import { configMapRow, configMapRows, configMapSearchText, type ConfigMapRow } from './row';

// The ConfigMap definition, as the mock's `PRINTER.ConfigMap` has it (MOCK k8s-resource-definitions.js:735-737; ch17 K60.1 and K60.3): kubectl prints a name, DATA and an age, so the list gets Keys
// (DATA, the mock's word), the first Key names and Size after the name, and Age. The mock has no quick filters for it, and the Columns chooser's (Immutable) waits for the list page to have it.

const identity = { group: '', version: 'v1', resource: 'configmaps' } as const;

const UNREADABLE = 'The ConfigMap\'s keys could not be read.';

export const configMapDefinition: KindDefinition<ConfigMapRow> = {
  identity,
  type: typeOf(identity),
  kind: 'ConfigMap',
  nouns: { one: 'ConfigMap', other: 'ConfigMaps' },
  page: 'configmaps',
  tile: { icon: 'file-cog', tone: 'blue' },
  model: { row: configMapRow, rows: configMapRows, searchText: configMapSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('keys', 'Keys', 'fixed', 50, 'right', 'number'),
    column('names', 'Key names', 'flex', 72, 'left', 'text'),
    column('size', 'Size', 'fixed', 58, 'right', 'number'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'keys', sortValue: (row) => row.keys, display: ({ keys }) => countCell(keys, UNREADABLE) },
    // The first three names and the number of the rest, as the mock's `listText` with `max: 3`; the whole list is the tip.
    { id: 'names', sortValue: (row) => row.names?.join(', '), display: ({ names }) => namesCell(names, 3, names === undefined ? UNREADABLE : 'The ConfigMap holds no keys.') },
    { id: 'size', sortValue: (row) => row.size, display: ({ size }) => textCell(size === undefined ? undefined : bytesText(size), UNREADABLE) },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The ConfigMap has no creation time.') },
  ],
};
