import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, flag, isObject, metadataOf, text, type ObjectMeta } from '../object';

// The part of a StorageClass that the list reads: who provisions its volumes, what becomes of them when their claim goes, when they bind and whether a claim may grow. A StorageClass has no spec and no status:
// these fields are at the top of the object. Anything the object does not hold is absent here, and stays absent downstream (`../object.ts`).

export type StorageClassObject = {
  readonly metadata?: ObjectMeta;
  readonly provisioner?: string;
  readonly reclaimPolicy?: string;
  readonly volumeBindingMode?: string;
  /** False for an object that states none: the API omits the field when it is false. Absent only for a body that is not an object, and for a value that is not a boolean. */
  readonly allowVolumeExpansion?: boolean;
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toStorageClass(value: unknown): StorageClassObject {
  if (!isObject(value)) {
    return {};
  }

  return {
    metadata: metadataOf(value.metadata),
    provisioner: text(value.provisioner),
    reclaimPolicy: text(value.reclaimPolicy),
    volumeBindingMode: text(value.volumeBindingMode),
    allowVolumeExpansion: value.allowVolumeExpansion === undefined ? false : flag(value.allowVolumeExpansion),
  };
}

/** The StorageClass a record holds. A body that is not a StorageClass gives an empty one, never an error: one odd object must not take the list down. */
export function storageClassObject(host: HostRecord): StorageClassObject {
  return toStorageClass(bodyOf(host));
}
