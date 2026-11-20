import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import { storageClassObject } from './object';

/** What the list holds of one StorageClass. A field the object does not hold is undefined. */
export type StorageClassRow = KindRow & {
  /** `provisioner`: kubectl's PROVISIONER. */
  readonly provisioner: string | undefined;
  /** `reclaimPolicy`: kubectl's RECLAIMPOLICY (`Delete` or `Retain`). */
  readonly reclaimPolicy: string | undefined;
  /** `volumeBindingMode`: kubectl's VOLUMEBINDINGMODE (`Immediate` or `WaitForFirstConsumer`). */
  readonly binding: string | undefined;
  /** `allowVolumeExpansion`: kubectl's ALLOWVOLUMEEXPANSION. False when the object states none (the API omits it when false). */
  readonly expansion: boolean | undefined;
};

/** A text the object states, or undefined for the empty string: a blank is not a value to draw. */
const stated = (value: string | undefined): string | undefined => (value === '' ? undefined : value);

// The StorageClasses' rows: one per record object, computed once (`../rows.ts`). A StorageClass lives in no namespace, so its row has none, and it has no state word.
export const { row: storageClassRow, rows: storageClassRows, searchText: storageClassSearchText } = rowModel(
  (host): StorageClassRow => {
    const storageClass = storageClassObject(host);
    return {
      ...identityOf(host, storageClass, false),
      provisioner: stated(storageClass.provisioner),
      reclaimPolicy: stated(storageClass.reclaimPolicy),
      binding: stated(storageClass.volumeBindingMode),
      expansion: storageClass.allowVolumeExpansion,
    };
  },
  (row) => [row.name, row.provisioner, row.reclaimPolicy, row.binding],
);
