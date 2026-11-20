import type { KindRow } from '../definition';
import { timeOf } from '../fields';
import { identityOf, rowModel } from '../rows';
import { statusOf, type KindStatus } from '../status';

import { cronJobObject } from './object';

/** What the list holds of one CronJob. A field the object does not hold is undefined. */
export type CronJobRow = KindRow & {
  /** `spec.schedule`, as written. */
  readonly schedule: string | undefined;
  /** How many Jobs `status.active` names: kubectl's ACTIVE. */
  readonly active: number | undefined;
  /** `status.lastScheduleTime`, epoch milliseconds: kubectl's LAST SCHEDULE. A CronJob that has not run has none. */
  readonly lastScheduleAt: number | undefined;
  /** The mock's word: Suspended when `spec.suspend` says so, else Active. kubectl prints the boolean (SUSPEND) and no word. */
  readonly status: KindStatus | undefined;
};

// The CronJobs' rows: one per record object, computed once (`../rows.ts`). A CronJob with no spec says nothing of its schedule or its state, and one with no status nothing of its Jobs: the list
// shows dashes, and no word is made up. A status with no `active` holds no Job, as the API omits an empty list and kubectl prints 0.
export const { row: cronJobRow, rows: cronJobRows, searchText: cronJobSearchText } = rowModel(
  (host): CronJobRow => {
    const cronJob = cronJobObject(host);
    const identity = identityOf(host, cronJob, false);
    const { spec, status } = cronJob;
    return {
      ...identity,
      schedule: spec?.schedule,
      active: status === undefined ? undefined : status.active ?? 0,
      lastScheduleAt: timeOf(status?.lastScheduleTime),
      status: spec === undefined ? undefined : statusOf(spec.suspend === true ? 'Suspended' : 'Active'),
    };
  },
  (row) => [row.name, row.namespace, row.schedule, row.status?.word, row.active?.toString()],
);
