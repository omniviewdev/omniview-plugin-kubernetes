import { column, typeOf, type KindDefinition } from '../definition';
import { ageCell, statusCell, textCell } from '../display';
import { bytesText } from '../fields';

import { persistentVolumeRow, persistentVolumeRows, persistentVolumeSearchText, type PersistentVolumeRow } from './row';

// The PersistentVolume definition, as the mock's `PRINTER.PersistentVolume` has it (MOCK k8s-resource-definitions.js:824-828; ch17 K60.3): after the name, Capacity, Status, Claim, Storage class and Age. The
// wide set (Access modes, Reclaim policy, Reason) and the Columns chooser's wait for the list page to have them. A PersistentVolume lives in no namespace: its read has no namespace in it, and its row has
// no second line under the name.

const identity = { group: '', version: 'v1', resource: 'persistentvolumes' } as const;

export const persistentVolumeDefinition: KindDefinition<PersistentVolumeRow> = {
  identity,
  type: typeOf(identity),
  kind: 'PersistentVolume',
  nouns: { one: 'PersistentVolume', other: 'PersistentVolumes' },
  page: 'persistentvolumes',
  tile: { icon: 'hard-drive', tone: 'blue' },
  model: { row: persistentVolumeRow, rows: persistentVolumeRows, searchText: persistentVolumeSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('capacity', 'Capacity', 'fixed', 75, 'right', 'number'),
    // 121 px holds the longest state word of a volume, `Terminating`, with its glyph (the mock's worksheet: 7.2 px a character plus 42).
    column('status', 'Status', 'fixed', 121, 'left', 'text'),
    column('claim', 'Claim', 'flex', 72, 'left', 'text'),
    column('storageClass', 'Storage class', 'flex', 72, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: () => null, tail: () => 0 },
    // The kind's own split of its state words (MOCK `bar`): a Pending or a Terminating volume is in All and in no chip.
    quickFilters: [
      { id: 'available', label: 'Available', tone: 'success', test: (row) => row.status?.word === 'Available' },
      { id: 'bound', label: 'Bound', tone: 'success', test: (row) => row.status?.word === 'Bound' },
      { id: 'released', label: 'Released', tone: 'warning', test: (row) => row.status?.word === 'Released' },
      { id: 'failed', label: 'Failed', tone: 'error', test: (row) => row.status?.word === 'Failed' },
    ],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    {
      id: 'capacity',
      sortValue: (row) => row.capacity,
      display: ({ capacity }) => textCell(capacity === undefined ? undefined : bytesText(capacity), 'The PersistentVolume states no capacity.'),
    },
    { id: 'status', sortValue: (row) => row.status?.word, display: ({ status }) => statusCell(status, 'The PersistentVolume reports no phase yet.') },
    { id: 'claim', sortValue: (row) => row.claim, display: ({ claim }) => textCell(claim, 'The volume is not claimed.') },
    { id: 'storageClass', sortValue: (row) => row.storageClass, display: ({ storageClass }) => textCell(storageClass, 'The volume names no storage class.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The PersistentVolume has no creation time.') },
  ],
};
