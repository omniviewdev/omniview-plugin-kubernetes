import { GENERIC_TILE, column, typeOf, type KindDefinition } from '../definition';
import { ageCell, namesCell } from '../display';

import { roleCell } from './binding';
import { roleBindingRow, roleBindingRows, roleBindingSearchText, type RoleBindingRow } from './row';

// The RoleBinding definition, as the mock's `PRINTER.RoleBinding` has it (MOCK k8s-resource-definitions.js:848-851 and the `'reference'` case of `displayCell`; ch17 K60.1 and K60.3): kubectl prints a name, the
// Role and an age, so the list gets Role, Subjects (the mock's `members`) and Age after the name. The mock has no quick filters for it, and its Users, Groups and Service accounts columns wait for the Columns
// chooser.

const identity = { group: 'rbac.authorization.k8s.io', version: 'v1', resource: 'rolebindings' } as const;

const UNREADABLE = 'The binding\'s subjects could not be read.';

export const roleBindingDefinition: KindDefinition<RoleBindingRow> = {
  identity,
  type: typeOf(identity),
  kind: 'RoleBinding',
  nouns: { one: 'RoleBinding', other: 'RoleBindings' },
  page: 'rolebindings',
  // The mock's glyph is a chain link (Lucide `link-2`), which the kit's registry does not have yet: the generic tile stands for it.
  tile: GENERIC_TILE,
  model: { row: roleBindingRow, rows: roleBindingRows, searchText: roleBindingSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('role', 'Role', 'flex', 72, 'left', 'text'),
    column('subjects', 'Subjects', 'flex', 72, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    // A Role, which a RoleBinding implies, is the name with `Role/name` in the tip; a ClusterRole is whole.
    { id: 'role', sortValue: ({ role }) => (role === undefined ? undefined : `${role.kind}/${role.name}`), display: ({ role }) => roleCell(role, 'Role') },
    // The first two names and the number of the rest, as the mock's `listText` with `max: 2`; the whole list is the tip.
    { id: 'subjects', sortValue: (row) => row.subjects?.join(', '), display: ({ subjects }) => namesCell(subjects, 2, subjects === undefined ? UNREADABLE : 'The binding has no subjects.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The RoleBinding has no creation time.') },
  ],
};
