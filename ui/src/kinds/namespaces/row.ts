import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';
import { statusOf, type KindStatus } from '../status';

import { namespaceObject } from './object';

/** What the list holds of one Namespace. A field the object does not hold is undefined. */
export type NamespaceRow = KindRow & {
  /** Terminating once the Namespace is marked for deletion, else its phase (`Active`): kubectl's STATUS, which is the phase. */
  readonly status: KindStatus | undefined;
};

// The Namespaces' rows: one per record object, computed once (`../rows.ts`). A Namespace lives in no namespace, so its row has none. The word is the mock's rule: Terminating once it is marked for deletion,
// else the phase the status states; a Namespace that states none has no word, and none is made up for it.
export const { row: namespaceRow, rows: namespaceRows, searchText: namespaceSearchText } = rowModel(
  (host): NamespaceRow => {
    const namespace = namespaceObject(host);
    const deleting = namespace.metadata?.deletionTimestamp !== undefined;
    return { ...identityOf(host, namespace, false), status: statusOf(deleting ? 'Terminating' : namespace.status?.phase) };
  },
  (row) => [row.name, row.status?.word],
);
