import type { KindRow, Ratio } from '../definition';
import { identityOf, rowModel } from '../rows';
import { statusOf, type KindStatus } from '../status';

import { podIP, podNode, podReady, podRestarts } from './fields';
import { podObject } from './pod';
import { podStatusWord } from './status';

/** What the list holds of one Pod. A field the object does not hold is undefined. */
export type PodRow = KindRow & {
  readonly ready: Ratio | undefined;
  readonly status: KindStatus | undefined;
  readonly restarts: number | undefined;
  readonly node: string | undefined;
  readonly ip: string | undefined;
};

// The Pod's rows: one per record object, computed once (`../rows.ts`). The status word is kubectl's STATUS, and its role is the one table's (`../status.ts`).
export const { row: podRow, rows: podRows, searchText: podSearchText } = rowModel(
  (host): PodRow => {
    const pod = podObject(host);
    return { ...identityOf(host, pod, true), ready: podReady(pod), status: statusOf(podStatusWord(pod)), restarts: podRestarts(pod), node: podNode(pod), ip: podIP(pod) };
  },
  (row) => [row.name, row.namespace, row.ready === undefined ? '' : `${row.ready.ready}/${row.ready.total}`, row.status?.word, row.restarts?.toString(), row.node, row.ip],
);
