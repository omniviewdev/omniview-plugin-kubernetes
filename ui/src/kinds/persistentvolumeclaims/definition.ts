import { column, typeOf, type KindDefinition } from '../definition';
import { ageCell, statusCell, textCell } from '../display';
import { bytesText } from '../fields';

import { persistentVolumeClaimRow, persistentVolumeClaimRows, persistentVolumeClaimSearchText, type PersistentVolumeClaimRow } from './row';

// The PersistentVolumeClaim definition, as the mock's `PRINTER.PersistentVolumeClaim` has it (MOCK k8s-resource-definitions.js:829-833; ch17 K60.3): after the name, Status, Volume, Capacity, Storage class
// and Age. The wide set (Access modes, Volume mode, Requested) and the Columns chooser's wait for the list page to have them. A claim lives in a namespace, which is the second line under its name.

const identity = { group: '', version: 'v1', resource: 'persistentvolumeclaims' } as const;

export const persistentVolumeClaimDefinition: KindDefinition<PersistentVolumeClaimRow> = {
  identity,
  type: typeOf(identity),
  kind: 'PersistentVolumeClaim',
  nouns: { one: 'PersistentVolumeClaim', other: 'PersistentVolumeClaims' },
  page: 'persistentvolumeclaims',
  tile: { icon: 'hard-drive-download', tone: 'blue' },
  model: { row: persistentVolumeClaimRow, rows: persistentVolumeClaimRows, searchText: persistentVolumeClaimSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    // 121 px holds the longest state word of a claim, `Terminating`, with its glyph (the mock's worksheet: 7.2 px a character plus 42).
    column('status', 'Status', 'fixed', 121, 'left', 'text'),
    column('volume', 'Volume', 'flex', 72, 'left', 'text'),
    column('capacity', 'Capacity', 'fixed', 75, 'right', 'number'),
    column('storageClass', 'Storage class', 'flex', 72, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    // The kind's own split of its state words (MOCK `bar`): a Terminating claim is in All and in no chip.
    quickFilters: [
      { id: 'bound', label: 'Bound', tone: 'success', test: (row) => row.status?.word === 'Bound' },
      { id: 'pending', label: 'Pending', tone: 'warning', test: (row) => row.status?.word === 'Pending' },
      { id: 'lost', label: 'Lost', tone: 'error', test: (row) => row.status?.word === 'Lost' },
    ],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'status', sortValue: (row) => row.status?.word, display: ({ status }) => statusCell(status, 'The claim reports no phase yet.') },
    { id: 'volume', sortValue: (row) => row.volume, display: ({ volume }) => textCell(volume, 'The claim is not bound to a volume.') },
    {
      id: 'capacity',
      sortValue: (row) => row.capacity,
      display: ({ capacity }) => textCell(capacity === undefined ? undefined : bytesText(capacity), 'The claim has no capacity yet.'),
    },
    { id: 'storageClass', sortValue: (row) => row.storageClass, display: ({ storageClass }) => textCell(storageClass, 'The claim names no storage class.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The PersistentVolumeClaim has no creation time.') },
  ],
};
