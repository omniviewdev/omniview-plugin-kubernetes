import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, isObject, metadataOf, objects, text, type ObjectMeta } from '../object';

// The part of a NetworkPolicy that the list reads: the selector of the Pods it applies to, as the requirements it holds (the labels that must match, and the expressions). The rules of traffic (`ingress`,
// `egress`) and the policy types wait for the Columns chooser. The API omits what is empty. Anything the object does not hold is absent here, and stays absent downstream (`../object.ts`).

/** One of `matchExpressions`: a key, an operator (`In`, `NotIn`, `Exists` or `DoesNotExist`) and the values it compares with, in the order the object holds them. */
export type SelectorExpression = {
  readonly key: string;
  readonly operator: string;
  readonly values: readonly string[];
};

/** A label selector: what `matchLabels` and `matchExpressions` require together. Both empty is the selector that selects every Pod. */
export type PodSelector = {
  /** Each label as its key and its value, in the order the object holds them. */
  readonly labels: ReadonlyArray<readonly [key: string, value: string]>;
  readonly expressions: readonly SelectorExpression[];
};

export type NetworkPolicyObject = {
  readonly metadata?: ObjectMeta;
  readonly spec?: {
    /** Absent when the spec holds no `podSelector`, or one that is not an object. */
    readonly podSelector?: PodSelector;
  };
};

/**
 * What the list reads of a label selector: each part kept only when it has the type the API gives it. A label whose value is not text, an expression that has no key or no operator, and a value that is
 * not text are not read: the API accepts none of them.
 */
function toSelector(value: unknown): PodSelector | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  return {
    labels: isObject(value.matchLabels) ? Object.entries(value.matchLabels).flatMap(([key, label]): ReadonlyArray<readonly [string, string]> => (typeof label === 'string' ? [[key, label]] : [])) : [],
    expressions:
      objects(value.matchExpressions)?.flatMap((expression): readonly SelectorExpression[] => {
        const key = text(expression.key);
        const operator = text(expression.operator);
        const values = Array.isArray(expression.values) ? expression.values.filter((item): item is string => typeof item === 'string') : [];
        return key === undefined || operator === undefined ? [] : [{ key, operator, values }];
      }) ?? [],
  };
}

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toNetworkPolicy(value: unknown): NetworkPolicyObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec } = value;
  return { metadata: metadataOf(metadata), spec: isObject(spec) ? { podSelector: toSelector(spec.podSelector) } : undefined };
}

/** The NetworkPolicy a record holds. A body that is not a NetworkPolicy gives an empty one, never an error: one odd object must not take the list down. */
export function networkPolicyObject(host: HostRecord): NetworkPolicyObject {
  return toNetworkPolicy(bodyOf(host));
}
