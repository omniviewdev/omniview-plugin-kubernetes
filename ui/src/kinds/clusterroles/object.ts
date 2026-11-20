import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, isObject, metadataOf, type ObjectMeta } from '../object';
import { rulesOf, type Rules } from '../roles/rules';

// The part of a ClusterRole that the list reads: its rules, read the way a Role's are (`../roles/rules.ts`). Its `aggregationRule` is not read: the controller fills the rules the aggregation selects into
// `rules`, and those are what the list counts. Anything the object does not hold is absent here, and stays absent downstream (`../object.ts`).

export type ClusterRoleObject = {
  readonly metadata?: ObjectMeta;
  /** Absent for a body that is not an object, and for `rules` that are not a list. */
  readonly rules?: Rules;
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toClusterRole(value: unknown): ClusterRoleObject {
  return isObject(value) ? { metadata: metadataOf(value.metadata), rules: rulesOf(value.rules) } : {};
}

/** The ClusterRole a record holds. A body that is not a ClusterRole gives an empty one, never an error: one odd object must not take the list down. */
export function clusterRoleObject(host: HostRecord): ClusterRoleObject {
  return toClusterRole(bodyOf(host));
}
