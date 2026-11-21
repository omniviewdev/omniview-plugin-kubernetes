import type { StatusSummaryItem } from '@omniviewdev/kit';
import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import type { KindCommands } from '../definition';
import { conditionRows, type ConditionInput } from '../detail/conditions';
import { annotationModels, labelModels } from '../detail/metadata';
import { conditionInputs, detailMeta, podTemplateOf, selectorOf, strategyOf, type DetailMeta } from '../detail/object';
import { facts, overviewModel, refFact, tagsFact, textFact, type KindOverview } from '../detail/overview';
import { counted, selectorItems, strategyText, type SelectorDetail, type StrategyDetail } from '../detail/text';
import { spanText } from '../fields';
import { bodyOf, count, flag, isObject, type Json } from '../object';

import { deploymentRow, type DeploymentRow } from './row';

// The page of one Deployment: what it says of the object a record holds, from the mock's `OVERVIEW.Deployment` (MOCK k8s-resource-definitions.js; K59). The values are the API's (decision A19) and the words
// are the mock's. The header's word is the list's (`deploymentRow`), so the page and the row never disagree about what state the Deployment is in. The tables of the template (containers, volumes, health
// checks), the related Pods and ReplicaSets and the aside's Requests and limits are not here: the status file of K2c-1 says what each needs.

/** The part of a Deployment that its page reads, beyond what its list reads (`./object.ts`). */
export type DeploymentDetail = {
  readonly metadata: DetailMeta;
  readonly spec: {
    readonly paused?: boolean | undefined;
    readonly strategy?: StrategyDetail | undefined;
    readonly selector?: SelectorDetail | undefined;
    /** The service account of the Pods it makes, from the template. */
    readonly serviceAccountName?: string | undefined;
    readonly revisionHistoryLimit?: number | undefined;
    readonly progressDeadlineSeconds?: number | undefined;
    readonly minReadySeconds?: number | undefined;
  };
  /** Undefined when the object holds no status at all. */
  readonly status?: { readonly unavailableReplicas?: number | undefined; readonly conditions?: readonly ConditionInput[] | undefined } | undefined;
};

const NOTHING: Json = {};

/** What the page reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
export function deploymentDetail(host: HostRecord): DeploymentDetail {
  const body = bodyOf(host);
  const { metadata, spec, status } = isObject(body) ? body : NOTHING;
  const specification = isObject(spec) ? spec : {};
  return {
    metadata: detailMeta(metadata),
    spec: {
      paused: flag(specification.paused),
      strategy: strategyOf(specification.strategy),
      selector: selectorOf(specification.selector),
      serviceAccountName: podTemplateOf(specification).serviceAccountName,
      revisionHistoryLimit: count(specification.revisionHistoryLimit),
      progressDeadlineSeconds: count(specification.progressDeadlineSeconds),
      minReadySeconds: count(specification.minReadySeconds),
    },
    status: isObject(status) ? { unavailableReplicas: count(status.unavailableReplicas), conditions: conditionInputs(status.conditions) } : undefined,
  };
}

/**
 * The one line that leads the first screen (design 12 FS1): `3/3 ready · up to date`, without the state (the chip says it). The ready count is the list's own (ready over what is wanted). The second
 * item is the mock's, with the API's number where the mock computes one: `1 unavailable` is `status.unavailableReplicas`, as `kubectl describe` prints it. A Deployment that says no replica count, or has
 * no status, says nothing here: no figure is made up.
 */
function summaryOf({ ready, updated }: DeploymentRow, { spec, status }: DeploymentDetail): readonly StatusSummaryItem[] {
  if (ready === undefined) {
    return [];
  }

  const unavailable = status?.unavailableReplicas ?? 0;
  const behind = spec.paused === true ? 'rollout paused' : unavailable > 0 ? `${unavailable} unavailable` : (updated ?? 0) < ready.total ? `${updated ?? 0} up to date` : 'up to date';
  return [{ value: `${ready.ready}/${ready.total}`, label: 'ready' }, { text: behind }];
}

const REVISION = 'deployment.kubernetes.io/revision';
const CHANGE_CAUSE = 'kubernetes.io/change-cause';

export const deploymentOverview = overviewModel((host): KindOverview => {
  const row = deploymentRow(host);
  const detail = deploymentDetail(host);
  const { metadata, spec, status } = detail;
  const cause = metadata.annotations[CHANGE_CAUSE];
  const account = spec.serviceAccountName;
  return {
    state: row.status,
    createdAt: row.createdAt,
    summary: summaryOf(row, detail),
    details: facts(
      textFact('strategy', 'Strategy', strategyText(spec.strategy)),
      textFact('revision', 'Revision', metadata.annotations[REVISION]),
      textFact('cause', 'Change cause', cause, { tip: cause, wide: true }),
      tagsFact('selector', 'Selector', selectorItems(spec.selector), { wide: true }),
      refFact('serviceAccount', 'Service account', account === undefined ? undefined : { kind: 'ServiceAccount', name: account, namespace: metadata.namespace }, { text: account }),
      textFact('history', 'Revision history', spec.revisionHistoryLimit === undefined ? undefined : counted(spec.revisionHistoryLimit, 'revision')),
      textFact('deadline', 'Progress deadline', spec.progressDeadlineSeconds === undefined ? undefined : spanText(spec.progressDeadlineSeconds)),
      textFact('minReady', 'Minimum ready time', spec.minReadySeconds === undefined || spec.minReadySeconds === 0 ? undefined : spanText(spec.minReadySeconds)),
    ),
    conditions: conditionRows(status?.conditions),
    labels: labelModels(metadata.labels),
    annotations: annotationModels(metadata.annotations),
  };
});

/**
 * The commands of a Deployment's header, as the mock lays them out for the kind (MOCK k8s-resource.js `LAYOUT.Deployment`; K59): Scale, Restart and Logs, Delete, and the menu. Every one of them is offered
 * unavailable (`../detail/commands.ts`). The rollout's toggle says what it would do: Pause rollout, or Resume rollout while the Deployment is paused.
 */
export function deploymentCommands(host: HostRecord): KindCommands {
  const paused = deploymentDetail(host).spec.paused === true;
  return {
    primary: { id: 'scale', label: 'Scale' },
    secondary: [{ id: 'restart', label: 'Restart' }, { id: 'logs', label: 'Logs' }],
    danger: { id: 'delete', label: 'Delete' },
    menu: [
      { id: 'rollback', label: 'Roll back…' },
      paused ? { id: 'resume', label: 'Resume rollout' } : { id: 'pause', label: 'Pause rollout' },
      { id: 'forward-port', label: 'Forward port…' },
      { id: 'events', label: 'Events' },
      { id: 'copy-name', label: 'Copy name' },
    ],
  };
}
