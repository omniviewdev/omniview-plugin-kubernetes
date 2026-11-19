import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, count, isObject, metadataOf, text, type ObjectMeta } from '../object';

// The part of a StatefulSet that the list reads. The API omits a count that is zero (`omitempty`): see `../deployments/object.ts`. Anything else the object does not hold is absent here, and
// stays absent downstream (`../object.ts`).

export type StatefulSetObject = {
  readonly metadata?: ObjectMeta;
  readonly spec?: { readonly replicas?: number; readonly serviceName?: string };
  readonly status?: { readonly readyReplicas?: number; readonly availableReplicas?: number; readonly updatedReplicas?: number };
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toStatefulSet(value: unknown): StatefulSetObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec, status } = value;
  return {
    metadata: metadataOf(metadata),
    spec: isObject(spec) ? { replicas: count(spec.replicas), serviceName: text(spec.serviceName) } : undefined,
    status: isObject(status)
      ? { readyReplicas: count(status.readyReplicas), availableReplicas: count(status.availableReplicas), updatedReplicas: count(status.updatedReplicas) }
      : undefined,
  };
}

/** The StatefulSet a record holds. A body that is not a StatefulSet gives an empty one, never an error: one odd object must not take the list down. */
export function statefulSetObject(host: HostRecord): StatefulSetObject {
  return toStatefulSet(bodyOf(host));
}
