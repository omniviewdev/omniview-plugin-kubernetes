import type { KindRow, Ratio } from '../definition';
import { identityOf, rowModel } from '../rows';
import { statusOf, type KindStatus } from '../status';
import { workloadState } from '../workload';

import { deploymentObject } from './object';

/** What the list holds of one Deployment. A field the object does not hold is undefined. */
export type DeploymentRow = KindRow & {
  /** `status.readyReplicas` over `spec.replicas`: kubectl's READY. */
  readonly ready: Ratio | undefined;
  /** `status.updatedReplicas`: kubectl's UP-TO-DATE. */
  readonly updated: number | undefined;
  /** The word of K61.3's rule over the counts (`../workload.ts`), and its role. */
  readonly status: KindStatus | undefined;
};

// The Deployments' rows: one per record object, computed once (`../rows.ts`). A Deployment that does not say how many replicas it wants, or has no status, says nothing of its counts: the
// list shows dashes, and no state word is made up for it. With both, a count the status leaves out is the API's zero, as kubectl prints it.
export const { row: deploymentRow, rows: deploymentRows, searchText: deploymentSearchText } = rowModel(
  (host): DeploymentRow => {
    const deployment = deploymentObject(host);
    const identity = identityOf(host, deployment, false);
    const { spec, status } = deployment;
    if (spec?.replicas === undefined || status === undefined) {
      return { ...identity, ready: undefined, updated: undefined, status: undefined };
    }

    const ready = status.readyReplicas ?? 0;
    const updated = status.updatedReplicas ?? 0;
    return {
      ...identity,
      ready: { ready, total: spec.replicas },
      updated,
      status: statusOf(workloadState({ paused: spec.paused === true, desired: spec.replicas, ready, available: status.availableReplicas ?? 0, updated })),
    };
  },
  (row) => [row.name, row.namespace, row.ready === undefined ? undefined : `${row.ready.ready}/${row.ready.total}`, row.status?.word, row.updated?.toString()],
);
