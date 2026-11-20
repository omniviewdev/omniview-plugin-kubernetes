import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import type { RoleRef } from './binding';
import { roleBindingObject } from './object';

/** What the list holds of one RoleBinding. A field the object does not hold is undefined. */
export type RoleBindingRow = KindRow & {
  /** The role the binding names, by kind and name. */
  readonly role: RoleRef | undefined;
  /** The name of each subject, once each, in order. */
  readonly subjects: readonly string[] | undefined;
};

// The RoleBindings' rows: one per record object, computed once (`../rows.ts`). A binding without subjects has `"subjects": null`: it holds none. A body that is not an object says nothing of its role and
// subjects: the list shows dashes, and nothing is made up for it.
export const { row: roleBindingRow, rows: roleBindingRows, searchText: roleBindingSearchText } = rowModel(
  (host): RoleBindingRow => {
    const binding = roleBindingObject(host);
    return { ...identityOf(host, binding, false), role: binding.role, subjects: binding.subjects };
  },
  (row) => [row.name, row.namespace, row.role === undefined ? undefined : `${row.role.kind}/${row.role.name}`, ...(row.subjects ?? [])],
);
