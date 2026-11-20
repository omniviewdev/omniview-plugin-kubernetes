import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, isObject, metadataOf, type ObjectMeta } from '../object';

import { roleRefOf, subjectNamesOf, type RoleRef } from './binding';

// The part of a RoleBinding that the list reads: the role it names and the names of its subjects (`./binding.ts`, which a ClusterRoleBinding reads the same way). Anything the object does not hold is absent
// here, and stays absent downstream (`../object.ts`).

export type RoleBindingObject = {
  readonly metadata?: ObjectMeta;
  /** Absent for a body that is not an object, and for a `roleRef` without a kind or a name. */
  readonly role?: RoleRef;
  /** Absent for a body that is not an object, and for `subjects` that are not a list. */
  readonly subjects?: readonly string[];
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toRoleBinding(value: unknown): RoleBindingObject {
  return isObject(value) ? { metadata: metadataOf(value.metadata), role: roleRefOf(value.roleRef), subjects: subjectNamesOf(value.subjects) } : {};
}

/** The RoleBinding a record holds. A body that is not a RoleBinding gives an empty one, never an error: one odd object must not take the list down. */
export function roleBindingObject(host: HostRecord): RoleBindingObject {
  return toRoleBinding(bodyOf(host));
}
