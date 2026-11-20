import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, isObject, metadataOf, text, type ObjectMeta } from '../object';

// The part of a PersistentVolumeClaim that the list reads: the volume it is bound to, its storage class, its phase and the capacity the volume gave it, and whether it is marked for deletion
// (`metadata.deletionTimestamp`, which the API sets while a finalizer holds the claim and the phase still says what it was). Anything the object does not hold is absent here, and stays absent
// downstream (`../object.ts`).

export type PersistentVolumeClaimObject = {
  readonly metadata?: ObjectMeta;
  readonly spec?: { readonly volumeName?: string; readonly storageClassName?: string };
  readonly status?: {
    readonly phase?: string;
    /** `status.capacity.storage`, the quantity as written (`1Gi`): what the bound volume gave, not what the claim asked for. */
    readonly capacity?: string;
  };
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toPersistentVolumeClaim(value: unknown): PersistentVolumeClaimObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec, status } = value;
  return {
    metadata: metadataOf(metadata),
    spec: isObject(spec) ? { volumeName: text(spec.volumeName), storageClassName: text(spec.storageClassName) } : undefined,
    status: isObject(status) ? { phase: text(status.phase), capacity: isObject(status.capacity) ? text(status.capacity.storage) : undefined } : undefined,
  };
}

/** The PersistentVolumeClaim a record holds. A body that is not a claim gives an empty one, never an error: one odd object must not take the list down. */
export function persistentVolumeClaimObject(host: HostRecord): PersistentVolumeClaimObject {
  return toPersistentVolumeClaim(bodyOf(host));
}
