import { GENERIC_TILE, column, typeOf, type KindDefinition } from '../definition';
import { ageCell, statusCell } from '../display';

import { namespaceRow, namespaceRows, namespaceSearchText, type NamespaceRow } from './row';

// The Namespace definition, as the mock's `PRINTER.Namespace` has it (MOCK k8s-resource-definitions.js:803-806; ch17 K60.3): after the name, Status and Age. The wide set (Labels) and the Columns chooser's
// (Finalizers, Marked for deletion) wait for the list page to have them. A Namespace lives in no namespace: its read has no namespace in it, and its row has no second line under the name.

const identity = { group: '', version: 'v1', resource: 'namespaces' } as const;

export const namespaceDefinition: KindDefinition<NamespaceRow> = {
  identity,
  type: typeOf(identity),
  kind: 'Namespace',
  nouns: { one: 'Namespace', other: 'Namespaces' },
  page: 'namespaces',
  // The mock's glyph is a folder tree (Lucide `FolderTree`), which the kit's registry has (`folder-tree`, the glyph of the scope lane's namespace face): this step gives every new kind the generic tile, so
  // the one rule is the same for all of them, and this line is the one to change when the kind's own glyph is taken.
  tile: GENERIC_TILE,
  model: { row: namespaceRow, rows: namespaceRows, searchText: namespaceSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    // 121 px holds the longest state word of a Namespace, `Terminating`, with its glyph (the mock's worksheet: 7.2 px a character plus 42).
    column('status', 'Status', 'fixed', 121, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: () => null, tail: () => 0 },
    // The kind's own split of its state words (MOCK `bar`).
    quickFilters: [
      { id: 'active', label: 'Active', tone: 'success', test: (row) => row.status?.word === 'Active' },
      { id: 'terminating', label: 'Terminating', tone: 'warning', test: (row) => row.status?.word === 'Terminating' },
    ],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'status', sortValue: (row) => row.status?.word, display: ({ status }) => statusCell(status, 'The Namespace reports no phase.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The Namespace has no creation time.') },
  ],
};
