import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import type { KindCommands } from '../definition';
import { conditionRows, type ConditionInput } from '../detail/conditions';
import { annotationModels, labelModels } from '../detail/metadata';
import { conditionInputs, detailMeta, type DetailMeta } from '../detail/object';
import { facts, momentFact, overviewModel, tagsFact, type KindOverview } from '../detail/overview';
import { timeOf } from '../fields';
import { bodyOf, isObject, text, type Json } from '../object';

import { namespaceRow } from './row';

// The page of one Namespace: what it says of the object a record holds, from the mock's `OVERVIEW.Namespace` (MOCK k8s-resource-definitions.js; K59). The values are the API's (decision A19) and the words
// are the mock's. The header's word is the list's (`namespaceRow`), so the page and the row never disagree. The mock's counts of what the Namespace holds (Pods, Deployments, ...) need a read of other
// kinds, which the page has none for: there is no summary.

/** The part of a Namespace that its page reads, beyond what its list reads (`./object.ts`). */
export type NamespaceDetail = {
  readonly metadata: DetailMeta;
  /** `spec.finalizers`, the ones that are text: what holds a Namespace that is being deleted. */
  readonly finalizers: readonly string[];
  /** Undefined when the object holds no list of conditions. */
  readonly conditions?: readonly ConditionInput[] | undefined;
};

const NOTHING: Json = {};

/** What the page reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
export function namespaceDetail(host: HostRecord): NamespaceDetail {
  const body = bodyOf(host);
  const { metadata, spec, status } = isObject(body) ? body : NOTHING;
  const finalizers = isObject(spec) && Array.isArray(spec.finalizers) ? spec.finalizers : [];
  return {
    metadata: detailMeta(metadata),
    finalizers: finalizers.flatMap((finalizer) => text(finalizer) ?? []),
    conditions: isObject(status) ? conditionInputs(status.conditions) : undefined,
  };
}

export const namespaceOverview = overviewModel((host): KindOverview => {
  const row = namespaceRow(host);
  const { metadata, finalizers, conditions } = namespaceDetail(host);
  // The API keeps its finalizers on a live Namespace too (`kubernetes`), where they say nothing a person acts on: they are said while the Namespace is being deleted, which is when they hold it.
  const terminating = row.status?.word === 'Terminating';
  return {
    state: row.status,
    createdAt: row.createdAt,
    summary: [],
    details: terminating
      ? facts(
        tagsFact('finalizers', 'Finalizers', finalizers.map((finalizer) => ({ key: finalizer }))),
        momentFact('deleting', 'Deleting since', timeOf(metadata.deletionTimestamp)),
      )
      : [],
    conditions: conditionRows(conditions),
    labels: labelModels(metadata.labels),
    annotations: annotationModels(metadata.annotations),
  };
});

/** The commands of a Namespace's header, as the mock lays them out for the kind (MOCK k8s-resource.js `LAYOUT.Namespace`; K59): Delete, and the menu. Every one is offered unavailable (`../detail/commands.ts`). */
export function namespaceCommands(): KindCommands {
  return {
    danger: { id: 'delete', label: 'Delete' },
    menu: [{ id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
  };
}
