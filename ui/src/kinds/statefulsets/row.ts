import type { KindRow, Ratio } from '../definition';
import { identityOf, rowModel } from '../rows';
import { statusOf, type KindStatus } from '../status';
import { workloadState } from '../workload';

import { statefulSetObject } from './object';

/** What the list holds of one StatefulSet. A field the object does not hold is undefined. */
export type StatefulSetRow = KindRow & {
  /** `status.readyReplicas` over `spec.replicas`: kubectl's READY. */
  readonly ready: Ratio | undefined;
  /** The governing Service: `spec.serviceName`. */
  readonly service: string | undefined;
  /** The word of K61.3's rule over the counts (`../workload.ts`), and its role. */
  readonly status: KindStatus | undefined;
};

// The StatefulSets' rows: one per record object, computed once (`../rows.ts`). As for a Deployment, a StatefulSet that does not say how many replicas it wants, or has no status, says nothing of
// its counts, and no state word is made up for it. A StatefulSet has no pause.
export const { row: statefulSetRow, rows: statefulSetRows, searchText: statefulSetSearchText } = rowModel(
  (host): StatefulSetRow => {
    const set = statefulSetObject(host);
    const identity = identityOf(host, set, false);
    const { spec, status } = set;
    const service = spec?.serviceName === '' ? undefined : spec?.serviceName;
    if (spec?.replicas === undefined || status === undefined) {
      return { ...identity, ready: undefined, service, status: undefined };
    }

    const ready = status.readyReplicas ?? 0;
    return {
      ...identity,
      ready: { ready, total: spec.replicas },
      service,
      status: statusOf(workloadState({ paused: false, desired: spec.replicas, ready, available: status.availableReplicas ?? 0, updated: status.updatedReplicas ?? 0 })),
    };
  },
  (row) => [row.name, row.namespace, row.ready === undefined ? undefined : `${row.ready.ready}/${row.ready.total}`, row.status?.word, row.service],
);
