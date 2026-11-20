import type { KindRow } from '../definition';
import { quantityOf } from '../quantity';
import { identityOf, rowModel } from '../rows';
import { statusOf, type KindStatus } from '../status';

import { persistentVolumeObject } from './object';

/** What the list holds of one PersistentVolume. A field the object does not hold is undefined. */
export type PersistentVolumeRow = KindRow & {
  /** `spec.capacity.storage` in bytes: kubectl's CAPACITY. Undefined for no capacity and for text that is not a quantity. */
  readonly capacity: number | undefined;
  /** Terminating once the volume is marked for deletion, else its phase (`Available`, `Bound`, `Released`, `Failed`, `Pending`): kubectl's STATUS. */
  readonly status: KindStatus | undefined;
  /** `<namespace>/<name>` of `spec.claimRef`: kubectl's CLAIM. A volume nobody claims has none. */
  readonly claim: string | undefined;
  /** `spec.storageClassName`: kubectl's STORAGECLASS. A volume that names none, or the empty string, has none. */
  readonly storageClass: string | undefined;
};

// The PersistentVolumes' rows: one per record object, computed once (`../rows.ts`). A volume lives in no namespace, so its row has none. The word is kubectl's (`printPersistentVolume`): Terminating once the
// volume is marked for deletion, else the phase; the mock reads the phase alone. A missing namespace or name in the claim reference is `?`, as the mock says it. The legacy storage-class annotation that
// kubectl falls back to is not read, as the mock does not.
export const { row: persistentVolumeRow, rows: persistentVolumeRows, searchText: persistentVolumeSearchText } = rowModel(
  (host): PersistentVolumeRow => {
    const volume = persistentVolumeObject(host);
    const { spec } = volume;
    const deleting = volume.metadata?.deletionTimestamp !== undefined;
    const claimRef = spec?.claimRef;
    return {
      ...identityOf(host, volume, false),
      capacity: quantityOf(spec?.capacity),
      status: statusOf(deleting ? 'Terminating' : volume.status?.phase),
      claim: claimRef === undefined ? undefined : `${claimRef.namespace || '?'}/${claimRef.name || '?'}`,
      storageClass: spec?.storageClassName === '' ? undefined : spec?.storageClassName,
    };
  },
  (row) => [row.name, row.status?.word, row.claim, row.storageClass],
);
