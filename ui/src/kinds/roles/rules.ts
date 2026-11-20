import { isObject } from '../object';

// What the list reads of the `rules` of a Role or a ClusterRole, which are the same shape: how many there are, and the names they reach (the mock's `ruleCount` and `resourceNamesOf`,
// MOCK k8s-resource-definitions.js:723). Both kinds' `object.ts` read their rules here, so that the two lists cannot come to disagree about what a rule is.

export type Rules = {
  /** The entries of `rules`, whatever they hold. */
  readonly count: number;
  /** The names the rules reach, once each, in order of first appearance: a rule's `resources` when it has that list, else its `nonResourceURLs`. `*` is a name like any other. */
  readonly resources: readonly string[];
};

const texts = (value: unknown): readonly string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

/**
 * The rules of an object, from its `rules` field. The API sends `"rules": null` for a role without rules, and may omit it: both are zero rules. A value that is neither a list nor absent says
 * nothing (undefined). A rule with an empty `resources` list reaches nothing and does not fall back to its URLs; an entry that is not an object counts as a rule and reaches nothing.
 */
export function rulesOf(value: unknown): Rules | undefined {
  if (value === undefined || value === null) {
    return { count: 0, resources: [] };
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const names = value.flatMap((rule: unknown) => (isObject(rule) ? texts(Array.isArray(rule.resources) ? rule.resources : rule.nonResourceURLs) : []));
  return { count: value.length, resources: [...new Set(names)] };
}
