import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, isObject, metadataOf, type ObjectMeta } from '../object';

// The part of a ServiceAccount that the list reads: how many Secrets it lists. Only the length of `secrets` is read: its entries are references to Secrets, and the names are not needed. The API
// omits an empty list, so an account without `secrets` lists none. Anything else the object does not hold is absent here, and stays absent downstream (`../object.ts`).

export type ServiceAccountObject = {
  readonly metadata?: ObjectMeta;
  /** The entries of `secrets`: zero when the object has none. Absent for a body that is not an object, and for `secrets` that are not a list. */
  readonly secrets?: number;
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toServiceAccount(value: unknown): ServiceAccountObject {
  if (!isObject(value)) {
    return {};
  }

  const { secrets } = value;
  return {
    metadata: metadataOf(value.metadata),
    secrets: Array.isArray(secrets) ? secrets.length : secrets === undefined || secrets === null ? 0 : undefined,
  };
}

/** The ServiceAccount a record holds. A body that is not a ServiceAccount gives an empty one, never an error: one odd object must not take the list down. */
export function serviceAccountObject(host: HostRecord): ServiceAccountObject {
  return toServiceAccount(bodyOf(host));
}
