import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';
import { statusOf, type KindStatus } from '../status';
import { workloadState } from '../workload';

import { daemonSetObject } from './object';

/** What the list holds of one DaemonSet. A field the object does not hold is undefined. */
export type DaemonSetRow = KindRow & {
  /** `status.desiredNumberScheduled`: kubectl's DESIRED, the nodes that should run a Pod. */
  readonly desired: number | undefined;
  /** `status.numberReady`: kubectl's READY. */
  readonly ready: number | undefined;
  /** `status.updatedNumberScheduled`: kubectl's UP-TO-DATE. */
  readonly updated: number | undefined;
  /** The word of K61.3's rule over the counts (`../workload.ts`), and its role. */
  readonly status: KindStatus | undefined;
};

// The DaemonSets' rows: one per record object, computed once (`../rows.ts`). A DaemonSet with no status says nothing of its counts, and no state word is made up for it. The API never omits
// `desiredNumberScheduled` and `numberReady` (a zero is written), so one that is absent is unknown, and the word waits for both; `updatedNumberScheduled` and `numberAvailable` are omitted when
// zero, so an absent one is the API's zero, as kubectl prints it. A DaemonSet has no pause.
export const { row: daemonSetRow, rows: daemonSetRows, searchText: daemonSetSearchText } = rowModel(
  (host): DaemonSetRow => {
    const daemon = daemonSetObject(host);
    const identity = identityOf(host, daemon, false);
    const { status } = daemon;
    if (status === undefined) {
      return { ...identity, desired: undefined, ready: undefined, updated: undefined, status: undefined };
    }

    const { desiredNumberScheduled: desired, numberReady: ready } = status;
    const updated = status.updatedNumberScheduled ?? 0;
    if (desired === undefined || ready === undefined) {
      return { ...identity, desired, ready, updated, status: undefined };
    }

    return { ...identity, desired, ready, updated, status: statusOf(workloadState({ paused: false, desired, ready, available: status.numberAvailable ?? 0, updated })) };
  },
  (row) => [row.name, row.namespace, row.status?.word, row.desired?.toString(), row.ready?.toString(), row.updated?.toString()],
);
