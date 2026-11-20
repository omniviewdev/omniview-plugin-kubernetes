import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';
import { statusOf, type KindStatus } from '../status';

import { nodeObject, type NodeObject } from './object';

/** What the list holds of one Node. A field the object does not hold is undefined. */
export type NodeRow = KindRow & {
  /** kubectl's STATUS: the word of `nodeState`, and its role. */
  readonly status: KindStatus | undefined;
  /** `status.nodeInfo.kubeletVersion`, whole (`v1.31.4-eks-aeac579`): kubectl's VERSION. */
  readonly version: string | undefined;
  /** The address of `status.addresses` of type InternalIP: what the mock says under the name. */
  readonly address: string | undefined;
};

/**
 * The state word of a Node, as kubectl prints it (`printNode`, k8s.io/kubernetes pkg/printers/internalversion/printers.go, v1.35.0): Ready when the Ready condition is True, NotReady when it is there
 * and is not (False or Unknown: kubectl asks only whether it is True), Unknown when there is none. kubectl adds `,SchedulingDisabled` for a Node that is cordoned; the list has one word for it
 * (K61.1: Scheduling disabled, a stopped state), for a Node that is Ready: a Node that is not never has its trouble hidden by a cordon, as in the mock. A Node with no status says nothing.
 */
export function nodeState({ spec, status }: NodeObject): string | undefined {
  if (status === undefined) {
    return undefined;
  }

  const ready = status.conditions?.find((condition) => condition.type === 'Ready');
  if (ready === undefined) {
    return 'Unknown';
  }

  if (ready.status !== 'True') {
    return 'NotReady';
  }

  return spec?.unschedulable === true ? 'Scheduling disabled' : 'Ready';
}

// The Nodes' rows: one per record object, computed once (`../rows.ts`). A Node lives in no namespace, so its row has none.
export const { row: nodeRow, rows: nodeRows, searchText: nodeSearchText } = rowModel(
  (host): NodeRow => {
    const node = nodeObject(host);
    const { status } = node;
    return {
      ...identityOf(host, node, false),
      status: statusOf(nodeState(node)),
      version: status?.kubeletVersion,
      address: status?.addresses?.find((address) => address.type === 'InternalIP')?.address,
    };
  },
  (row) => [row.name, row.status?.word, row.version, row.address],
);
