import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import { clusterRoleObject } from './object';

/** What the list holds of one ClusterRole. A field the object does not hold is undefined. */
export type ClusterRoleRow = KindRow & {
  /** How many rules the ClusterRole has, the ones an aggregation filled in included. */
  readonly rules: number | undefined;
  /** The names the rules reach (`../roles/rules.ts`). */
  readonly resources: readonly string[] | undefined;
};

// The ClusterRoles' rows: one per record object, computed once (`../rows.ts`). A ClusterRole without rules has `"rules": null`: it holds zero rules and reaches no resource. A body that is not an object says
// nothing of its rules: the list shows dashes, and no zero is made up for it.
export const { row: clusterRoleRow, rows: clusterRoleRows, searchText: clusterRoleSearchText } = rowModel(
  (host): ClusterRoleRow => {
    const role = clusterRoleObject(host);
    return { ...identityOf(host, role, false), rules: role.rules?.count, resources: role.rules?.resources };
  },
  (row) => [row.name, ...(row.resources ?? [])],
);
