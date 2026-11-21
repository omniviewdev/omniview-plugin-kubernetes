import type { StatusSummaryItem } from '@omniviewdev/kit';
import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import type { KindCommands } from '../definition';
import { conditionRows, type ConditionInput } from '../detail/conditions';
import { annotationModels, labelModels } from '../detail/metadata';
import { conditionInputs, detailMeta, podTemplateOf, selectorOf, statusBehind, strategyOf, type DetailMeta } from '../detail/object';
import { facts, overviewModel, refFact, tagsFact, textFact, type KindOverview } from '../detail/overview';
import { retentionText, selectorItems, strategyText, UPDATE_NOT_OBSERVED, type RetentionDetail, type SelectorDetail, type StrategyDetail } from '../detail/text';
import { bodyOf, count, isObject, text, type Json } from '../object';

import { statefulSetRow, type StatefulSetRow } from './row';

// The page of one StatefulSet: what it says of the object a record holds, from the mock's `OVERVIEW.StatefulSet` (MOCK k8s-resource-definitions.js; K59). The values are the API's (decision A19) and the
// words are the mock's. The header's word is the list's (`statefulSetRow`), so the page and the row never disagree about what state the StatefulSet is in. The tables of the template and the related
// Pods and claims are not here: the status file of K2c-1 says what each needs.

/** The part of a StatefulSet that its page reads, beyond what its list reads (`./object.ts`). */
export type StatefulSetDetail = {
  readonly metadata: DetailMeta;
  readonly spec: {
    readonly strategy?: StrategyDetail | undefined;
    readonly podManagementPolicy?: string | undefined;
    /** Undefined when the object states no policy: the page then says none. */
    readonly retention?: RetentionDetail | undefined;
    readonly selector?: SelectorDetail | undefined;
    /** The service account of the Pods it makes, from the template. */
    readonly serviceAccountName?: string | undefined;
  };
  /** Undefined when the object holds no status at all. */
  readonly status?: {
    readonly updatedReplicas?: number | undefined;
    readonly updateRevision?: string | undefined;
    readonly observedGeneration?: number | undefined;
    readonly conditions?: readonly ConditionInput[] | undefined;
  } | undefined;
};

const NOTHING: Json = {};

/** What the page reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
export function statefulSetDetail(host: HostRecord): StatefulSetDetail {
  const body = bodyOf(host);
  const { metadata, spec, status } = isObject(body) ? body : NOTHING;
  const specification = isObject(spec) ? spec : {};
  const policy = specification.persistentVolumeClaimRetentionPolicy;
  return {
    metadata: detailMeta(metadata),
    spec: {
      strategy: strategyOf(specification.updateStrategy),
      podManagementPolicy: text(specification.podManagementPolicy),
      retention: isObject(policy) ? { whenDeleted: text(policy.whenDeleted), whenScaled: text(policy.whenScaled) } : undefined,
      selector: selectorOf(specification.selector),
      serviceAccountName: podTemplateOf(specification).serviceAccountName,
    },
    status: isObject(status)
      ? { updatedReplicas: count(status.updatedReplicas), updateRevision: text(status.updateRevision), observedGeneration: count(status.observedGeneration), conditions: conditionInputs(status.conditions) }
      : undefined,
  };
}

/**
 * The one line that leads the first screen (design 12 FS1): `2/2 ready · up to date`, without the state (the chip says it). The ready count is the list's own (ready over what is wanted). The API omits
 * `updatedReplicas` for none, so an absent one is zero once the object has a status. A status that describes an older spec than the object holds (`statusBehind`) says no count of Pods up to date: it would be
 * against the older template (the API defines `updatedReplicas` relative to `status.updateRevision`). A StatefulSet that says no replica count, or has no status, says nothing here: no figure is made up.
 */
function summaryOf({ ready }: StatefulSetRow, { metadata, status }: StatefulSetDetail): readonly StatusSummaryItem[] {
  if (ready === undefined) {
    return [];
  }

  const updated = status?.updatedReplicas ?? 0;
  const behind = statusBehind(metadata.generation, status?.observedGeneration) ? UPDATE_NOT_OBSERVED : updated < ready.total ? `${updated} up to date` : 'up to date';
  return [{ value: `${ready.ready}/${ready.total}`, label: 'ready' }, { text: behind }];
}

export const statefulSetOverview = overviewModel((host): KindOverview => {
  const row = statefulSetRow(host);
  const detail = statefulSetDetail(host);
  const { metadata, spec, status } = detail;
  const { service } = row;
  const account = spec.serviceAccountName;
  return {
    state: row.status,
    createdAt: row.createdAt,
    summary: summaryOf(row, detail),
    details: facts(
      refFact('service', 'Service', service === undefined ? undefined : { kind: 'Service', name: service, namespace: metadata.namespace }, { text: service }),
      textFact('strategy', 'Update strategy', strategyText(spec.strategy)),
      textFact('management', 'Pod management', spec.podManagementPolicy),
      textFact('retention', 'Claim retention', retentionText(spec.retention)),
      textFact('revision', 'Revision', status?.updateRevision, { mono: true }),
      refFact('serviceAccount', 'Service account', account === undefined ? undefined : { kind: 'ServiceAccount', name: account, namespace: metadata.namespace }, { text: account }),
      tagsFact('selector', 'Selector', selectorItems(spec.selector), { wide: true }),
    ),
    conditions: conditionRows(status?.conditions),
    labels: labelModels(metadata.labels),
    annotations: annotationModels(metadata.annotations),
  };
});

/** The commands of a StatefulSet's header, as the mock lays them out for the kind (MOCK k8s-resource.js `LAYOUT.StatefulSet`; K59). Every one of them is offered unavailable (`../detail/commands.ts`). */
export function statefulSetCommands(): KindCommands {
  return {
    primary: { id: 'scale', label: 'Scale' },
    secondary: [{ id: 'restart', label: 'Restart' }, { id: 'logs', label: 'Logs' }],
    danger: { id: 'delete', label: 'Delete' },
    menu: [{ id: 'forward-port', label: 'Forward port…' }, { id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
  };
}
