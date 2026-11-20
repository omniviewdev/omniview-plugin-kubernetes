import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import { secretObject } from './object';

/** What the list holds of one Secret: its type and how many keys it has. Never a key's name and never what a key holds. */
export type SecretRow = KindRow & {
  /** `type`, as the platform spells it (`Opaque`, `kubernetes.io/tls`): kubectl's TYPE. */
  readonly type: string | undefined;
  /** How many keys `data` holds: kubectl's DATA. */
  readonly keys: number | undefined;
};

// The Secrets' rows: one per record object, computed once (`../rows.ts`). A Secret that holds no key has no `data` (the API omits an empty map): it holds zero keys, as kubectl prints. A body that is
// not an object says nothing of its keys: the list shows dashes, and no zero is made up for it. What a search can read in a row is the name, the namespace and the type: nothing a Secret holds.
export const { row: secretRow, rows: secretRows, searchText: secretSearchText } = rowModel(
  (host): SecretRow => {
    const secret = secretObject(host);
    return { ...identityOf(host, secret, false), type: secret.type, keys: secret.keys };
  },
  (row) => [row.name, row.namespace, row.type],
);
