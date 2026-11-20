import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import { networkPolicyObject } from './object';

/** What the list holds of one NetworkPolicy. A field the object does not hold is undefined. */
export type NetworkPolicyRow = KindRow & {
  /**
   * The requirements of `spec.podSelector`, joined by a comma and a space: each label as `key=value`, then each expression as `key operator (values)`. `All pods` for a selector that has none, which
   * selects every Pod of the Namespace (kubectl prints `<none>`). Undefined when the policy states no pod selector: kubectl's POD-SELECTOR.
   */
  readonly podSelector: string | undefined;
};

// The NetworkPolicies' rows: one per record object, computed once (`../rows.ts`). A policy that states no pod selector says nothing of it: the list shows a dash. An expression is said as the mock's
// `selectorLines` says it: the key, the operator, and the values in parentheses when it has any (`app In (web, api)`, `tier Exists`). The mock reads only `matchLabels`, so a selector made of expressions
// alone would read `All pods` there, which is false: the list says every requirement the object holds.
export const { row: networkPolicyRow, rows: networkPolicyRows, searchText: networkPolicySearchText } = rowModel(
  (host): NetworkPolicyRow => {
    const policy = networkPolicyObject(host);
    const selector = policy.spec?.podSelector;
    const requirements = selector === undefined
      ? undefined
      : [
        ...selector.labels.map(([key, value]) => `${key}=${value}`),
        ...selector.expressions.map(({ key, operator, values }) => `${key} ${operator}${values.length === 0 ? '' : ` (${values.join(', ')})`}`),
      ];
    return {
      ...identityOf(host, policy, false),
      podSelector: requirements === undefined ? undefined : requirements.length === 0 ? 'All pods' : requirements.join(', '),
    };
  },
  (row) => [row.name, row.namespace, row.podSelector],
);
