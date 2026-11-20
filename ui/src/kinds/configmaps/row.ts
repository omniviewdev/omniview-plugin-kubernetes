import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import { configMapObject } from './object';

/** What the list holds of one ConfigMap. A field the object does not hold is undefined. */
export type ConfigMapRow = KindRow & {
  /** How many keys `data` and `binaryData` hold together: kubectl's DATA. */
  readonly keys: number | undefined;
  /** The names of the keys, in order. */
  readonly names: readonly string[] | undefined;
  /** The bytes of the values together. */
  readonly size: number | undefined;
};

// The ConfigMaps' rows: one per record object, computed once (`../rows.ts`). A ConfigMap that holds no key has no `data` (the API omits an empty map): it holds zero keys, as kubectl prints. A body that is
// not an object says nothing of its keys: the list shows dashes, and no zero is made up for it.
export const { row: configMapRow, rows: configMapRows, searchText: configMapSearchText } = rowModel(
  (host): ConfigMapRow => {
    const configMap = configMapObject(host);
    const identity = identityOf(host, configMap, false);
    const { entries } = configMap;
    return entries === undefined ? { ...identity, keys: undefined, names: undefined, size: undefined } : { ...identity, keys: entries.names.length, names: entries.names, size: entries.size };
  },
  (row) => [row.name, row.namespace, ...(row.names ?? [])],
);
