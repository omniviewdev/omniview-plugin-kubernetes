import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, isObject, metadataOf, text, type ObjectMeta } from '../object';

// The part of a PersistentVolume that the list reads: its capacity, the claim that holds it, its storage class and its phase, and whether it is marked for deletion (`metadata.deletionTimestamp`, which the
// API sets while a finalizer holds the volume and the phase still says what it was). Anything the object does not hold is absent here, and stays absent downstream (`../object.ts`).

export type PersistentVolumeObject = {
  readonly metadata?: ObjectMeta;
  readonly spec?: {
    /** `spec.capacity.storage`, the quantity as written (`1Gi`). */
    readonly capacity?: string;
    /** The reference to the claim: where it lives and what it is called. */
    readonly claimRef?: { readonly namespace?: string; readonly name?: string };
    readonly storageClassName?: string;
  };
  readonly status?: { readonly phase?: string };
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toPersistentVolume(value: unknown): PersistentVolumeObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec, status } = value;
  return {
    metadata: metadataOf(metadata),
    spec: isObject(spec)
      ? {
        capacity: isObject(spec.capacity) ? text(spec.capacity.storage) : undefined,
        claimRef: isObject(spec.claimRef) ? { namespace: text(spec.claimRef.namespace), name: text(spec.claimRef.name) } : undefined,
        storageClassName: text(spec.storageClassName),
      }
      : undefined,
    status: isObject(status) ? { phase: text(status.phase) } : undefined,
  };
}

/** The PersistentVolume a record holds. A body that is not a PersistentVolume gives an empty one, never an error: one odd object must not take the list down. */
export function persistentVolumeObject(host: HostRecord): PersistentVolumeObject {
  return toPersistentVolume(bodyOf(host));
}
