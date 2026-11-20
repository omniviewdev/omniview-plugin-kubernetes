import type { KindRow } from '../definition';
import { quantityOf } from '../quantity';
import { identityOf, rowModel } from '../rows';
import { statusOf, type KindStatus } from '../status';

import { persistentVolumeClaimObject } from './object';

/** What the list holds of one PersistentVolumeClaim. A field the object does not hold is undefined. */
export type PersistentVolumeClaimRow = KindRow & {
  /** Terminating once the claim is marked for deletion, else its phase (`Bound`, `Pending`, `Lost`): kubectl's STATUS. */
  readonly status: KindStatus | undefined;
  /** `spec.volumeName`: kubectl's VOLUME. A claim that is not bound has none, and so has one that names the empty string. */
  readonly volume: string | undefined;
  /** `status.capacity.storage` in bytes: kubectl's CAPACITY. Undefined while the claim has none, and for text that is not a quantity. */
  readonly capacity: number | undefined;
  /** `spec.storageClassName`: kubectl's STORAGECLASS. A claim that names none, or the empty string (on purpose), has none. */
  readonly storageClass: string | undefined;
};

// The claims' rows: one per record object, computed once (`../rows.ts`). The word is kubectl's (`printPersistentVolumeClaim`): Terminating once the claim is marked for deletion, else the phase; the mock reads
// the phase alone. The capacity is the one the status states: a Lost claim has none, where kubectl prints the zero Quantity (`0`), and the row says nothing, as the object does.
export const { row: persistentVolumeClaimRow, rows: persistentVolumeClaimRows, searchText: persistentVolumeClaimSearchText } = rowModel(
  (host): PersistentVolumeClaimRow => {
    const claim = persistentVolumeClaimObject(host);
    const deleting = claim.metadata?.deletionTimestamp !== undefined;
    return {
      ...identityOf(host, claim, false),
      status: statusOf(deleting ? 'Terminating' : claim.status?.phase),
      volume: claim.spec?.volumeName === '' ? undefined : claim.spec?.volumeName,
      capacity: quantityOf(claim.status?.capacity),
      storageClass: claim.spec?.storageClassName === '' ? undefined : claim.spec?.storageClassName,
    };
  },
  (row) => [row.name, row.namespace, row.status?.word, row.volume, row.storageClass],
);
