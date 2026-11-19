import type { KindRow, Ratio } from '../definition';
import { identityOf, rowModel } from '../rows';
import { statusOf, type KindStatus } from '../status';

import { jobObject, type JobObject } from './object';

/** Succeeded over wanted, and, for a Job that wants no count but runs several at a time, how many (kubectl prints `2/1 of 2`). */
export type JobCompletions = Ratio & { readonly parallel?: number };

/** What the list holds of one Job. A field the object does not hold is undefined. */
export type JobRow = KindRow & {
  /** `succeeded` over `spec.completions` (one when it sets none): kubectl's COMPLETIONS. */
  readonly completions: JobCompletions | undefined;
  /** `status.startTime`, epoch milliseconds: a Job that has not started (a suspended one) has none. */
  readonly startedAt: number | undefined;
  /** `status.completionTime`, epoch milliseconds: a Job that failed has none, as one that still runs has none. */
  readonly finishedAt: number | undefined;
  /** kubectl's STATUS: the word of `jobState`, and its role. */
  readonly status: KindStatus | undefined;
};

const timeOf = (value: string | undefined): number | undefined => {
  const time = value === undefined ? Number.NaN : Date.parse(value);
  return Number.isNaN(time) ? undefined : time;
};

/**
 * kubectl's STATUS column for a Job, as the API server prints it (`printJob`, k8s.io/kubernetes pkg/printers/internalversion/printers.go, v1.35.0): the first that holds of the Complete and Failed
 * conditions, a deletion in progress (Terminating), the Suspended condition (a request to suspend, `spec.suspend`, is Running until the controller says so), the two conditions of a Job that is
 * finishing (FailureTarget, SuccessCriteriaMet), else Running. The goldens in golden.test.ts are its output.
 */
export function jobState(job: JobObject): string {
  const has = (type: string) => job.status?.conditions?.some((condition) => condition.type === type && condition.status === 'True') === true;
  if (has('Complete')) {
    return 'Complete';
  }

  if (has('Failed')) {
    return 'Failed';
  }

  if (job.metadata?.deletionTimestamp !== undefined) {
    return 'Terminating';
  }

  for (const type of ['Suspended', 'FailureTarget', 'SuccessCriteriaMet']) {
    if (has(type)) {
      return type;
    }
  }

  return 'Running';
}

/** kubectl's COMPLETIONS text: `succeeded/completions`, or `succeeded/1 of N` when no count is set and N are run at a time, or `succeeded/1`. */
export const completionsText = ({ ready, total, parallel }: JobCompletions): string => `${ready}/${total}${parallel === undefined ? '' : ` of ${parallel}`}`;

// The Jobs' rows: one per record object, computed once (`../rows.ts`). A Job that has no spec or no status says nothing of its state or its counts: the list shows dashes, and no word is made up.
// With both, a count the status leaves out is the API's zero, and a count the spec leaves out is one, as kubectl prints it.
export const { row: jobRow, rows: jobRows, searchText: jobSearchText } = rowModel(
  (host): JobRow => {
    const job = jobObject(host);
    const identity = { ...identityOf(host, job, true) };
    const { spec, status } = job;
    const startedAt = timeOf(status?.startTime);
    const finishedAt = timeOf(status?.completionTime);
    if (spec === undefined || status === undefined) {
      return { ...identity, completions: undefined, startedAt, finishedAt, status: undefined };
    }

    const parallel = spec.completions === undefined && (spec.parallelism ?? 1) > 1 ? spec.parallelism : undefined;
    return {
      ...identity,
      completions: { ready: status.succeeded ?? 0, total: spec.completions ?? 1, ...(parallel === undefined ? {} : { parallel }) },
      startedAt,
      finishedAt,
      status: statusOf(jobState(job)),
    };
  },
  (row) => [row.name, row.namespace, row.status?.word, row.completions === undefined ? undefined : completionsText(row.completions)],
);
