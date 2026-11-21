import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import type { KindCommands } from '../definition';
import { annotationModels, labelModels } from '../detail/metadata';
import { detailMeta, type DetailMeta } from '../detail/object';
import { facts, momentFact, overviewModel, textFact, type DetailFact, type KindOverview } from '../detail/overview';
import { describeCron } from '../detail/text';
import { timeOf } from '../fields';
import { bodyOf, count, flag, isObject, objects, text, type Json } from '../object';

import { cronJobRow } from './row';

// The page of one CronJob: what it says of the object a record holds, from the mock's `OVERVIEW.CronJob` (MOCK k8s-resource-definitions.js; K59). The values are the API's (decision A19) and the words are the
// mock's. The header's word is the list's (`cronJobRow`), so the page and the row never disagree. The mock's summary (`next run in 12 min`, `last run 3 min ago`) needs a cron evaluator and a clock, and the
// summary has no kind of item that a clock drives: the status file of K2c-1 records both as not expressed, so the summary is empty.

/** The part of a CronJob that its page reads, beyond what its list reads (`./object.ts`). */
export type CronJobDetail = {
  readonly metadata: DetailMeta;
  readonly spec: {
    readonly schedule?: string | undefined;
    readonly timeZone?: string | undefined;
    readonly concurrencyPolicy?: string | undefined;
    readonly suspend?: boolean | undefined;
    readonly successfulJobsHistoryLimit?: number | undefined;
    readonly failedJobsHistoryLimit?: number | undefined;
  };
  /** Undefined when the object holds no status at all. `active` is how many Jobs the status lists: the API omits an empty list, so a status without one holds none. */
  readonly status?: { readonly lastScheduleTime?: number | undefined; readonly active: number } | undefined;
};

const NOTHING: Json = {};

/** What the page reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
export function cronJobDetail(host: HostRecord): CronJobDetail {
  const body = bodyOf(host);
  const { metadata, spec, status } = isObject(body) ? body : NOTHING;
  const specification = isObject(spec) ? spec : NOTHING;
  return {
    metadata: detailMeta(metadata),
    spec: {
      schedule: text(specification.schedule),
      timeZone: text(specification.timeZone),
      concurrencyPolicy: text(specification.concurrencyPolicy),
      suspend: flag(specification.suspend),
      successfulJobsHistoryLimit: count(specification.successfulJobsHistoryLimit),
      failedJobsHistoryLimit: count(specification.failedJobsHistoryLimit),
    },
    status: isObject(status) ? { lastScheduleTime: timeOf(text(status.lastScheduleTime)), active: objects(status.active)?.length ?? 0 } : undefined,
  };
}

/** The schedule in the mock's words, with the expression as its tip, or, for one it has no words for, the expression itself in mono: the cell always shows what the API says. */
function scheduleFact(schedule: string | undefined): DetailFact | undefined {
  if (schedule === undefined || schedule === '') {
    return undefined;
  }

  const words = describeCron(schedule);
  return words === undefined ? textFact('schedule', 'Schedule', schedule, { mono: true }) : textFact('schedule', 'Schedule', words, { tip: schedule });
}

export const cronJobOverview = overviewModel((host): KindOverview => {
  const row = cronJobRow(host);
  const { metadata, spec, status } = cronJobDetail(host);
  const { schedule, successfulJobsHistoryLimit: successful, failedJobsHistoryLimit: failed } = spec;
  return {
    state: row.status,
    createdAt: row.createdAt,
    summary: [],
    details: facts(
      scheduleFact(schedule),
      // The expression is its own row only when the first one shows words: otherwise it already is the row.
      schedule === undefined || describeCron(schedule) === undefined ? undefined : textFact('cron', 'Cron expression', schedule, { mono: true }),
      textFact('zone', 'Time zone', spec.timeZone),
      textFact('concurrency', 'Concurrency policy', spec.concurrencyPolicy),
      momentFact('last', 'Last schedule', status?.lastScheduleTime),
      textFact('active', 'Active Jobs', status === undefined ? undefined : String(status.active)),
      // Both limits or none: half a pair would read as the other one being unlimited.
      textFact('history', 'History limits', successful === undefined || failed === undefined ? undefined : `${successful} successful · ${failed} failed`),
    ),
    // A CronJob states no conditions.
    conditions: [],
    labels: labelModels(metadata.labels),
    annotations: annotationModels(metadata.annotations),
  };
});

/**
 * The commands of a CronJob's header, as the mock lays them out for the kind (MOCK k8s-resource.js `LAYOUT.CronJob`; K59): Run now, the toggle of its schedule, Delete, and the menu. Every one of them is
 * offered unavailable (`../detail/commands.ts`). The toggle says what it would do: Suspend, or Resume while the CronJob is suspended.
 */
export function cronJobCommands(host: HostRecord): KindCommands {
  const suspended = cronJobDetail(host).spec.suspend === true;
  return {
    primary: { id: 'run-now', label: 'Run now' },
    secondary: [suspended ? { id: 'resume', label: 'Resume' } : { id: 'suspend', label: 'Suspend' }],
    danger: { id: 'delete', label: 'Delete' },
    menu: [{ id: 'logs', label: 'Logs' }, { id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
  };
}
