import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import { serviceAccountObject } from './object';

/** What the list holds of one ServiceAccount. A field the object does not hold is undefined. */
export type ServiceAccountRow = KindRow & {
  /** How many Secrets the account lists: the entries of `secrets`. */
  readonly secrets: number | undefined;
};

// The ServiceAccounts' rows: one per record object, computed once (`../rows.ts`). An account without `secrets` (the API omits an empty list) lists zero Secrets, as the mock's `zero: true` says. A body that
// is not an object says nothing of its Secrets: the list shows a dash, and no zero is made up for it.
export const { row: serviceAccountRow, rows: serviceAccountRows, searchText: serviceAccountSearchText } = rowModel(
  (host): ServiceAccountRow => {
    const account = serviceAccountObject(host);
    return { ...identityOf(host, account, false), secrets: account.secrets };
  },
  (row) => [row.name, row.namespace],
);
