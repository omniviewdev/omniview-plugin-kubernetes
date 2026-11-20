import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';
import { statusOf, type KindStatus } from '../status';
import { replicaSetState } from '../workload';

import { replicaSetObject } from './object';

/** What the list holds of one ReplicaSet. A field the object does not hold is undefined. */
export type ReplicaSetRow = KindRow & {
  /** `spec.replicas`: kubectl's DESIRED. */
  readonly desired: number | undefined;
  /** `status.replicas`: kubectl's CURRENT. */
  readonly current: number | undefined;
  /** `status.readyReplicas`: kubectl's READY. */
  readonly ready: number | undefined;
  /** The word of K61.3's rule over the counts (`../workload.ts`), and its role. */
  readonly status: KindStatus | undefined;
};

// The ReplicaSets' rows: one per record object, computed once (`../rows.ts`). A ReplicaSet that does not say how many replicas it wants, or has no status, says nothing of its counts: the list shows
// dashes, and no state word is made up for it. With both, a count the status leaves out is the API's zero, as kubectl prints it.
export const { row: replicaSetRow, rows: replicaSetRows, searchText: replicaSetSearchText } = rowModel(
  (host): ReplicaSetRow => {
    const replicaSet = replicaSetObject(host);
    // A ReplicaSet's name is generated: the hash of its Deployment's template.
    const identity = identityOf(host, replicaSet, true);
    const { spec, status } = replicaSet;
    if (spec?.replicas === undefined || status === undefined) {
      return { ...identity, desired: undefined, current: undefined, ready: undefined, status: undefined };
    }

    const ready = status.readyReplicas ?? 0;
    return {
      ...identity,
      desired: spec.replicas,
      current: status.replicas ?? 0,
      ready,
      status: statusOf(replicaSetState({ desired: spec.replicas, ready, available: status.availableReplicas ?? 0 })),
    };
  },
  (row) => [row.name, row.namespace, row.status?.word, row.desired?.toString(), row.current?.toString(), row.ready?.toString()],
);
