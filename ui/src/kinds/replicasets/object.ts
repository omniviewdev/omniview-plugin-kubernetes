import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, count, isObject, metadataOf, type ObjectMeta } from '../object';

// The part of a ReplicaSet that the list reads. The API omits a count that is zero (`omitempty`), so a count the status does not carry is the API's zero; that is read in `row.ts`, where it is
// known whether the object has a status at all. Anything else the object does not hold is absent here, and stays absent downstream (`../object.ts`).

export type ReplicaSetObject = {
  readonly metadata?: ObjectMeta;
  readonly spec?: { readonly replicas?: number };
  readonly status?: { readonly replicas?: number; readonly readyReplicas?: number; readonly availableReplicas?: number };
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toReplicaSet(value: unknown): ReplicaSetObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec, status } = value;
  return {
    metadata: metadataOf(metadata),
    spec: isObject(spec) ? { replicas: count(spec.replicas) } : undefined,
    status: isObject(status) ? { replicas: count(status.replicas), readyReplicas: count(status.readyReplicas), availableReplicas: count(status.availableReplicas) } : undefined,
  };
}

/** The ReplicaSet a record holds. A body that is not a ReplicaSet gives an empty one, never an error: one odd object must not take the list down. */
export function replicaSetObject(host: HostRecord): ReplicaSetObject {
  return toReplicaSet(bodyOf(host));
}
