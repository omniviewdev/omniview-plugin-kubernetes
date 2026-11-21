import type { StatusSummaryItem, TagItem } from '@omniviewdev/kit';
import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import type { KindCommands } from '../definition';
import { conditionRows, type ConditionInput } from '../detail/conditions';
import { annotationModels, labelModels } from '../detail/metadata';
import { conditionInputs, detailMeta, podTemplateOf, selectorOf, strategyOf, type DetailMeta } from '../detail/object';
import { facts, overviewModel, refFact, tagsFact, textFact, type DetailFact, type KindOverview } from '../detail/overview';
import { selectorItems, strategyText, type SelectorDetail, type StrategyDetail } from '../detail/text';
import { bodyOf, count, isObject, type Json } from '../object';

import { daemonSetRow } from './row';

// The page of one DaemonSet: what it says of the object a record holds, from the mock's `OVERVIEW.DaemonSet` (MOCK k8s-resource-definitions.js; K59). The values are the API's (decision A19) and the
// words are the mock's. The header's word is the list's (`daemonSetRow`), so the page and the row never disagree about what state the DaemonSet is in. The tables of the template and the related Pods
// are not here: the status file of K2c-1 says what each needs.

/** The part of a DaemonSet that its page reads, beyond what its list reads (`./object.ts`). */
export type DaemonSetDetail = {
  readonly metadata: DetailMeta;
  readonly spec: {
    readonly strategy?: StrategyDetail | undefined;
    readonly selector?: SelectorDetail | undefined;
    /** The service account of the Pods it makes, from the template. */
    readonly serviceAccountName?: string | undefined;
    /** The labels a Node must carry to take a Pod, from the template. Undefined when the template states none. */
    readonly nodeSelector?: Readonly<Record<string, string>> | undefined;
  };
  /** Undefined when the object holds no status at all. */
  readonly status?: { readonly numberMisscheduled?: number | undefined; readonly conditions?: readonly ConditionInput[] | undefined } | undefined;
};

const NOTHING: Json = {};

/** What the page reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
export function daemonSetDetail(host: HostRecord): DaemonSetDetail {
  const body = bodyOf(host);
  const { metadata, spec, status } = isObject(body) ? body : NOTHING;
  const specification = isObject(spec) ? spec : {};
  const template = podTemplateOf(specification);
  return {
    metadata: detailMeta(metadata),
    spec: {
      strategy: strategyOf(specification.updateStrategy),
      selector: selectorOf(specification.selector),
      serviceAccountName: template.serviceAccountName,
      nodeSelector: template.nodeSelector,
    },
    status: isObject(status) ? { numberMisscheduled: count(status.numberMisscheduled), conditions: conditionInputs(status.conditions) } : undefined,
  };
}

const EVERY_NODE = 'All nodes';

/** The Node selector as the mock says it: the labels a Node must carry as chips, and `All nodes` for a DaemonSet that asks for none (it then runs one Pod on every node). */
function nodeSelectorFact(labels: Readonly<Record<string, string>> | undefined): DetailFact | undefined {
  const items: readonly TagItem[] = Object.entries(labels ?? {}).map(([key, value]) => ({ key, value }));
  return items.length === 0 ? textFact('nodeSelector', 'Node selector', EVERY_NODE) : tagsFact('nodeSelector', 'Node selector', items);
}

/**
 * The one line that leads the first screen (design 12 FS1): `3/3 ready · 3 up to date`, without the state (the chip says it). The API never omits the two counts of the ratio, so a DaemonSet that
 * lacks either says nothing here; `updatedNumberScheduled` it omits for none, so an absent one is zero (the list says the same, `./row.ts`).
 */
function summaryOf({ desired, ready, updated }: ReturnType<typeof daemonSetRow>): readonly StatusSummaryItem[] {
  return desired === undefined || ready === undefined || updated === undefined ? [] : [{ value: `${ready}/${desired}`, label: 'ready' }, { text: `${updated} up to date` }];
}

export const daemonSetOverview = overviewModel((host): KindOverview => {
  const row = daemonSetRow(host);
  const { metadata, spec, status } = daemonSetDetail(host);
  const account = spec.serviceAccountName;
  const misscheduled = status?.numberMisscheduled;
  return {
    state: row.status,
    createdAt: row.createdAt,
    summary: summaryOf(row),
    details: facts(
      nodeSelectorFact(spec.nodeSelector),
      textFact('strategy', 'Update strategy', strategyText(spec.strategy)),
      textFact('misscheduled', 'Misscheduled', misscheduled === undefined || misscheduled <= 0 ? undefined : String(misscheduled)),
      refFact('serviceAccount', 'Service account', account === undefined ? undefined : { kind: 'ServiceAccount', name: account, namespace: metadata.namespace }, { text: account }),
      tagsFact('selector', 'Selector', selectorItems(spec.selector), { wide: true }),
    ),
    conditions: conditionRows(status?.conditions),
    labels: labelModels(metadata.labels),
    annotations: annotationModels(metadata.annotations),
  };
});

/** The commands of a DaemonSet's header, as the mock lays them out for the kind (MOCK k8s-resource.js `LAYOUT.DaemonSet`; K59). Every one of them is offered unavailable (`../detail/commands.ts`). */
export function daemonSetCommands(): KindCommands {
  return {
    primary: { id: 'restart', label: 'Restart' },
    secondary: [{ id: 'logs', label: 'Logs' }],
    danger: { id: 'delete', label: 'Delete' },
    menu: [{ id: 'forward-port', label: 'Forward port…' }, { id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
  };
}
