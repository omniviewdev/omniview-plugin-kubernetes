import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import { roleObject } from './object';

/** What the list holds of one Role. A field the object does not hold is undefined. */
export type RoleRow = KindRow & {
  /** How many rules the role has. */
  readonly rules: number | undefined;
  /** The names the rules reach (`./rules.ts`). */
  readonly resources: readonly string[] | undefined;
};

// The Roles' rows: one per record object, computed once (`../rows.ts`). A role without rules has `"rules": null`: it holds zero rules and reaches no resource. A body that is not an object says nothing of
// its rules: the list shows dashes, and no zero is made up for it.
export const { row: roleRow, rows: roleRows, searchText: roleSearchText } = rowModel(
  (host): RoleRow => {
    const role = roleObject(host);
    return { ...identityOf(host, role, false), rules: role.rules?.count, resources: role.rules?.resources };
  },
  (row) => [row.name, row.namespace, ...(row.resources ?? [])],
);
