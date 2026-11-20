import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, count, isObject, metadataOf, type ObjectMeta } from '../object';

// The part of a PodDisruptionBudget that the list reads: how many disruptions its status allows now. What the budget asks for (`minAvailable`, `maxUnavailable`: a number or a percent) is the mock's wide set,
// which the list contract has no place for yet. Anything the object does not hold is absent here, and stays absent downstream (`../object.ts`).

export type PodDisruptionBudgetObject = {
  readonly metadata?: ObjectMeta;
  readonly status?: { readonly disruptionsAllowed?: number };
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toPodDisruptionBudget(value: unknown): PodDisruptionBudgetObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, status } = value;
  return { metadata: metadataOf(metadata), status: isObject(status) ? { disruptionsAllowed: count(status.disruptionsAllowed) } : undefined };
}

/** The PodDisruptionBudget a record holds. A body that is not one gives an empty one, never an error: one odd object must not take the list down. */
export function podDisruptionBudgetObject(host: HostRecord): PodDisruptionBudgetObject {
  return toPodDisruptionBudget(bodyOf(host));
}
