import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, count, isObject, metadataOf, type ObjectMeta } from '../object';

// The part of a DaemonSet that the list reads: its status, which holds every count the list says (a DaemonSet wants as many Pods as nodes match, and says so in `desiredNumberScheduled`).
// The API omits a count that is zero for `updatedNumberScheduled` and `numberAvailable` (`omitempty`) and never omits `desiredNumberScheduled` or `numberReady`: see `row.ts`. Anything else the object does not hold is absent here, and
// stays absent downstream (`../object.ts`).

export type DaemonSetObject = {
  readonly metadata?: ObjectMeta;
  readonly status?: {
    readonly desiredNumberScheduled?: number;
    readonly numberReady?: number;
    readonly updatedNumberScheduled?: number;
    readonly numberAvailable?: number;
  };
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toDaemonSet(value: unknown): DaemonSetObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, status } = value;
  return {
    metadata: metadataOf(metadata),
    status: isObject(status)
      ? {
        desiredNumberScheduled: count(status.desiredNumberScheduled),
        numberReady: count(status.numberReady),
        updatedNumberScheduled: count(status.updatedNumberScheduled),
        numberAvailable: count(status.numberAvailable),
      }
      : undefined,
  };
}

/** The DaemonSet a record holds. A body that is not a DaemonSet gives an empty one, never an error: one odd object must not take the list down. */
export function daemonSetObject(host: HostRecord): DaemonSetObject {
  return toDaemonSet(bodyOf(host));
}
