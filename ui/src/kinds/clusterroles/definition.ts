import { GENERIC_TILE, column, typeOf, type KindDefinition } from '../definition';
import { ageCell, countCell, namesCell } from '../display';

import { clusterRoleRow, clusterRoleRows, clusterRoleSearchText, type ClusterRoleRow } from './row';

// The ClusterRole definition, as the mock's `PRINTER.ClusterRole` has it (MOCK k8s-resource-definitions.js:847; ch17 K60.1 and K60.3): kubectl prints a name and the creation time only, so the list gets the
// next most useful columns, Rules and Resources, after the name, and Age. The mock has no quick filters for it, and its Aggregation column waits for the Columns chooser.

const identity = { group: 'rbac.authorization.k8s.io', version: 'v1', resource: 'clusterroles' } as const;

const UNREADABLE = 'The role\'s rules could not be read.';

export const clusterRoleDefinition: KindDefinition<ClusterRoleRow> = {
  identity,
  type: typeOf(identity),
  kind: 'ClusterRole',
  nouns: { one: 'ClusterRole', other: 'ClusterRoles' },
  page: 'clusterroles',
  // The mock's glyph is a badge with a check (Lucide `badge-check`), which the kit's registry does not have yet: the generic tile stands for it.
  tile: GENERIC_TILE,
  model: { row: clusterRoleRow, rows: clusterRoleRows, searchText: clusterRoleSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('rules', 'Rules', 'fixed', 54, 'right', 'number'),
    column('resources', 'Resources', 'flex', 72, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    // A ClusterRole lives in no namespace: there is no second line.
    identity: { second: () => null, tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'rules', sortValue: (row) => row.rules, display: ({ rules }) => countCell(rules, UNREADABLE) },
    // The first three names and the number of the rest, as the mock's `listText` with `max: 3`; the whole list is the tip.
    { id: 'resources', sortValue: (row) => row.resources?.join(', '), display: ({ resources }) => namesCell(resources, 3, resources === undefined ? UNREADABLE : 'The role grants no resource.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The ClusterRole has no creation time.') },
  ],
};
