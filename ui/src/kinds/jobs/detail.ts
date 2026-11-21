import type { StatusSummaryItem } from '@omniviewdev/kit';
import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import type { KindCommands } from '../definition';
import { conditionRows, type ConditionInput } from '../detail/conditions';
import { annotationModels, labelModels } from '../detail/metadata';
import { conditionInputs, controllerOf, detailMeta, type DetailMeta } from '../detail/object';
import { facts, momentFact, overviewModel, refFact, runningFact, textFact, type KindOverview } from '../detail/overview';
import { spanText } from '../fields';
import { bodyOf, count, isObject, type Json } from '../object';

import { completionsText, jobRow, type JobRow } from './row';

// The page of one Job: what it says of the object a record holds, from the mock's `OVERVIEW.Job` (MOCK k8s-resource-definitions.js; K59). The values are the API's (decision A19) and the words are the
// mock's. The header's word is the list's (`jobRow`, kubectl's printJob), so the page and the row never disagree about what state the Job is in. The tables of the template and the related Pods are not
// here: the status file of K2c-1 says what each needs.

/** The part of a Job that its page reads, beyond what its list reads (`./object.ts`). */
export type JobDetail = {
  readonly metadata: DetailMeta;
  readonly spec: {
    readonly parallelism?: number | undefined;
    readonly backoffLimit?: number | undefined;
    readonly activeDeadlineSeconds?: number | undefined;
    readonly ttlSecondsAfterFinished?: number | undefined;
  };
  /** The conditions of the status; undefined when the object states none. */
  readonly conditions?: readonly ConditionInput[] | undefined;
};

const NOTHING: Json = {};

/** What the page reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
export function jobDetail(host: HostRecord): JobDetail {
  const body = bodyOf(host);
  const { metadata, spec, status } = isObject(body) ? body : NOTHING;
  const specification = isObject(spec) ? spec : {};
  return {
    metadata: detailMeta(metadata),
    spec: {
      parallelism: count(specification.parallelism),
      backoffLimit: count(specification.backoffLimit),
      activeDeadlineSeconds: count(specification.activeDeadlineSeconds),
      ttlSecondsAfterFinished: count(specification.ttlSecondsAfterFinished),
    },
    conditions: isObject(status) ? conditionInputs(status.conditions) : undefined,
  };
}

/** The mock's words for the two reasons a Job fails for; any other reason is said as the API spells it. */
const FAILURE_WORDS: Readonly<Record<string, string>> = { BackoffLimitExceeded: 'backoff limit reached', DeadlineExceeded: 'deadline exceeded' };

/**
 * The one note that follows the state (the chip says it): how long a finished Job took, why a failed one failed, how far a running one is. Any other state (Suspended, Terminating, and the two a Job
 * passes through as it finishes) has nothing to add, and a Job that does not state what the note needs says none: no figure or reason is made up.
 */
function summaryOf({ status, completions, startedAt, finishedAt }: JobRow, { conditions }: JobDetail): readonly StatusSummaryItem[] {
  switch (status?.word) {
    case 'Complete':
      return startedAt === undefined || finishedAt === undefined ? [] : [{ text: `took ${spanText((finishedAt - startedAt) / 1000)}` }];
    case 'Failed': {
      // A Job that fails holds a FailureTarget condition first and the Failed one after: it is the Failed condition that holds which this word comes from.
      const reason = conditions?.find((condition) => condition.type === 'Failed' && condition.status === 'True')?.reason;
      return reason === undefined || reason === '' ? [] : [{ text: FAILURE_WORDS[reason] ?? reason }];
    }
    case 'Running':
      return completions === undefined ? [] : [{ text: `${completionsText(completions)} completions` }];
    default:
      return [];
  }
}

/** The Pod page's time-free rule (`../pod/overview/model.ts` STARTED_AFTER_MS): a Job starts a moment after it is made, and the header's age already says so. */
const STARTED_AFTER_MS = 60_000;

export const jobOverview = overviewModel((host): KindOverview => {
  const row = jobRow(host);
  const detail = jobDetail(host);
  const { metadata, spec, conditions } = detail;
  const owner = controllerOf(metadata.ownerReferences);
  const { startedAt, createdAt } = row;
  const late = startedAt !== undefined && (createdAt === undefined || startedAt - createdAt >= STARTED_AFTER_MS);
  return {
    state: row.status,
    createdAt,
    summary: summaryOf(row, detail),
    details: facts(
      textFact('completions', 'Completions', row.completions === undefined ? undefined : completionsText(row.completions)),
      textFact('parallelism', 'Parallelism', spec.parallelism === undefined ? undefined : String(spec.parallelism)),
      textFact('backoff', 'Backoff limit', spec.backoffLimit === undefined ? undefined : String(spec.backoffLimit)),
      refFact('owner', 'Owner', owner === undefined ? undefined : { kind: owner.kind, name: owner.name, namespace: metadata.namespace }),
      momentFact('started', 'Started', late ? startedAt : undefined),
      runningFact('duration', 'Duration', row.status?.word === 'Running' ? startedAt : undefined),
      textFact('deadline', 'Time limit', spec.activeDeadlineSeconds === undefined || spec.activeDeadlineSeconds <= 0 ? undefined : spanText(spec.activeDeadlineSeconds)),
      textFact('cleanup', 'Cleaned up', spec.ttlSecondsAfterFinished === undefined ? undefined : `${spanText(spec.ttlSecondsAfterFinished)} after it finishes`),
    ),
    conditions: conditionRows(conditions),
    labels: labelModels(metadata.labels),
    annotations: annotationModels(metadata.annotations),
  };
});

/** The commands of a Job's header, as the mock lays them out for the kind (MOCK k8s-resource.js `LAYOUT.Job`; K59). Every one of them is offered unavailable (`../detail/commands.ts`). */
export function jobCommands(): KindCommands {
  return {
    primary: { id: 'logs', label: 'Logs' },
    danger: { id: 'delete', label: 'Delete' },
    menu: [{ id: 'forward-port', label: 'Forward port…' }, { id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }, { id: 'suspend', label: 'Suspend…' }],
  };
}
