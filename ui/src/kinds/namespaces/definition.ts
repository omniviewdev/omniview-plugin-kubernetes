import { column, typeOf, type KindDefinition } from '../definition';
import { ageCell, statusCell } from '../display';

import { namespaceCommands, namespaceOverview } from './detail';
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
  tile: { icon: 'folder-tree', tone: 'blue' },
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
  // The page of one Namespace (`./detail.ts`), drawn by the generic detail page. It lives in no namespace: its route is its name.
  detail: { page: 'namespace', identity: ['name'], overview: namespaceOverview, commands: namespaceCommands },
};
