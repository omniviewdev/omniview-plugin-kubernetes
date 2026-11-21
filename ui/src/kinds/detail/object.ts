import { count, flag, isObject, objects, text } from '../object';

import type { ConditionInput } from './conditions';
import { intOrString, type SelectorDetail, type StrategyDetail } from './text';

// What a kind's page reads of an object, beyond what its list reads (`../object.ts`): the labels and annotations, the owners, the conditions, the selector and the strategy. A record body is an exact `Value`
// tree, not a Kubernetes object, and `bodyOf` (`../object.ts`) is its presentation projection. A decoder keeps a field only when it has the type the API gives it, so what the object does not hold is absent
// here and stays absent downstream: nothing in this layer turns a missing field into 0, an empty string or a word.

/** A string-to-string map (labels, annotations, a Service's selector): the entries whose value is a string, in the object's order. */
export function strings(value: unknown): Readonly<Record<string, string>> {
  return isObject(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
}

export type OwnerReference = {
  readonly kind?: string | undefined;
  readonly name?: string | undefined;
  readonly controller?: boolean | undefined;
};

/** The metadata every page reads. */
export type DetailMeta = {
  readonly name?: string | undefined;
  readonly namespace?: string | undefined;
  readonly uid?: string | undefined;
  readonly creationTimestamp?: string | undefined;
  readonly generation?: number | undefined;
  readonly deletionTimestamp?: string | undefined;
  readonly labels: Readonly<Record<string, string>>;
  readonly annotations: Readonly<Record<string, string>>;
  readonly ownerReferences: readonly OwnerReference[];
};

export function detailMeta(value: unknown): DetailMeta {
  const meta = isObject(value) ? value : {};
  return {
    name: text(meta.name),
    namespace: text(meta.namespace),
    uid: text(meta.uid),
    creationTimestamp: text(meta.creationTimestamp),
    generation: count(meta.generation),
    deletionTimestamp: text(meta.deletionTimestamp),
    labels: strings(meta.labels),
    annotations: strings(meta.annotations),
    ownerReferences: (objects(meta.ownerReferences) ?? []).map((owner) => ({ kind: text(owner.kind), name: text(owner.name), controller: flag(owner.controller) })),
  };
}

/**
 * Whether a workload's status describes an older spec than the one the object holds. `metadata.generation` counts the changes to the spec and `status.observedGeneration` is the last of them its controller has
 * seen (what `kubectl rollout status` waits for): until they meet, the counts of the status (the Pods that are up to date) are against the older template. A status with no observed generation is behind too, as the
 * API omits it until the controller has seen the object once. An object that states no generation cannot be told to be behind.
 */
export function statusBehind(generation: number | undefined, observed: number | undefined): boolean {
  return generation !== undefined && (observed ?? 0) < generation;
}

/** The owner that controls the object (`controller: true`), when it names a kind and a name: what a Job's Owner says. */
export function controllerOf(owners: readonly OwnerReference[]): (OwnerReference & { readonly kind: string; readonly name: string }) | undefined {
  const owner = owners.find((candidate) => candidate.controller === true);
  return owner?.kind === undefined || owner.name === undefined ? undefined : { ...owner, kind: owner.kind, name: owner.name };
}

/** The conditions of an object's status, each field kept when it is text. An object that holds no list has none. */
export function conditionInputs(value: unknown): readonly ConditionInput[] | undefined {
  return objects(value)?.map((condition) => ({
    type: text(condition.type),
    status: text(condition.status),
    reason: text(condition.reason),
    message: text(condition.message),
    lastTransitionTime: text(condition.lastTransitionTime),
  }));
}

/**
 * A selector: a label selector (`matchLabels` and `matchExpressions`) or, with `shape` `labels`, a plain map of labels (a Service's `spec.selector`, a Node selector). Undefined for what is not an object.
 */
export function selectorOf(value: unknown, shape: 'selector' | 'labels' = 'selector'): SelectorDetail | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  if (shape === 'labels') {
    return { matchLabels: strings(value) };
  }

  return {
    matchLabels: strings(value.matchLabels),
    matchExpressions: (objects(value.matchExpressions) ?? []).flatMap((expression) =>
      typeof expression.key === 'string' && typeof expression.operator === 'string'
        ? [{ key: expression.key, operator: expression.operator, values: Array.isArray(expression.values) ? expression.values.filter((entry): entry is string => typeof entry === 'string') : undefined }]
        : [],
    ),
  };
}

/** How a workload replaces its Pods (`spec.strategy` of a Deployment, `spec.updateStrategy` of a StatefulSet or a DaemonSet): the type and the limits of a rolling update, as written. */
export function strategyOf(value: unknown): StrategyDetail | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const rolling = isObject(value.rollingUpdate) ? value.rollingUpdate : {};
  return { type: text(value.type), maxSurge: intOrString(rolling.maxSurge), maxUnavailable: intOrString(rolling.maxUnavailable), partition: intOrString(rolling.partition) };
}

/** What a workload says of the Pods it makes, in the template of its spec: the service account they run as, and the labels a Node must carry to take them (a DaemonSet's Node selector). */
export type PodTemplateDetail = {
  readonly serviceAccountName?: string | undefined;
  readonly nodeSelector?: Readonly<Record<string, string>> | undefined;
};

/** The Pod template of a workload's `spec` (`spec.template.spec`). */
export function podTemplateOf(spec: unknown): PodTemplateDetail {
  const template = isObject(spec) && isObject(spec.template) ? spec.template : {};
  const pod = isObject(template.spec) ? template.spec : {};
  return { serviceAccountName: text(pod.serviceAccountName), nodeSelector: isObject(pod.nodeSelector) ? strings(pod.nodeSelector) : undefined };
}
