import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, isObject, metadataOf, type ObjectMeta } from '../object';

import { rulesOf, type Rules } from './rules';

// The part of a Role that the list reads: its rules (`./rules.ts`, which a ClusterRole reads the same way). Anything the object does not hold is absent here, and stays absent downstream (`../object.ts`).

export type RoleObject = {
  readonly metadata?: ObjectMeta;
  /** Absent for a body that is not an object, and for `rules` that are not a list. */
  readonly rules?: Rules;
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toRole(value: unknown): RoleObject {
  return isObject(value) ? { metadata: metadataOf(value.metadata), rules: rulesOf(value.rules) } : {};
}

/** The Role a record holds. A body that is not a Role gives an empty one, never an error: one odd object must not take the list down. */
export function roleObject(host: HostRecord): RoleObject {
  return toRole(bodyOf(host));
}
