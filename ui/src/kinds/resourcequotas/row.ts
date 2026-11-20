import type { KindRow } from '../definition';
import { bytesText } from '../fields';
import { quantityOf } from '../quantity';
import { identityOf, rowModel } from '../rows';

import { resourceQuotaObject, type ResourceQuotaObject } from './object';

/** What the list holds of one ResourceQuota. A field the object does not hold is undefined. */
export type ResourceQuotaRow = KindRow & {
  /** One piece for each hard limit on `requests.` (`cpu 0.4 of 1`: what is used of what is allowed), sorted by the name of the resource. A quota that sets none has none. */
  readonly request: readonly string[] | undefined;
  /** The same for each hard limit on `limits.`. */
  readonly limit: readonly string[] | undefined;
};

/**
 * A quantity as the mock says it (`quotaValue`, MOCK k8s-resource-definitions.js:716): a size of memory or storage in K61.1's units (`192 MiB`), the cores of a cpu with no unit and exact to three decimals
 * (the mock's one decimal reads 150m as 0.1 and 250m as 0.3, which the API does not say), and anything else, a text that is no quantity among it, as it is. A usage the status holds none of is `0`.
 */
function quantityText(resource: string, quantity: string | undefined): string {
  if (quantity === undefined) {
    return '0';
  }

  const amount = quantityOf(quantity);
  if (amount === undefined) {
    return quantity;
  }

  if (/memory|storage/.test(resource)) {
    return bytesText(amount);
  }

  return /cpu/.test(resource) ? String(Number(amount.toFixed(3))) : quantity;
}

/**
 * The pieces for the hard limits whose resource starts with `prefix`, sorted by resource as kubectl sorts them: `cpu 0.4 of 1` for `requests.cpu`. The limits are those of the status, which the controller
 * enforces, and those of the spec while the status has none (the mock's `quotaText`). None when no limit starts with the prefix.
 */
function piecesOf({ spec, status }: ResourceQuotaObject, prefix: string): readonly string[] | undefined {
  const hard = status?.hard ?? spec?.hard ?? {};
  const pieces = Object.keys(hard)
    .filter((resource) => resource.startsWith(prefix))
    .sort()
    .map((resource) => `${resource.slice(prefix.length)} ${quantityText(resource, status?.used?.[resource])} of ${quantityText(resource, hard[resource])}`);
  return pieces.length === 0 ? undefined : pieces;
}

// The ResourceQuotas' rows: one per record object, computed once (`../rows.ts`). The limits on other resources than `requests.` and `limits.` (the Pod count, the counts of objects) are in no column: the mock keeps
// them for its Columns chooser, and kubectl's REQUEST column is the only one that has them. A quota that sets no limit with a prefix, an object that has no spec and no status, and a body that is not an object
// say nothing of it: the list shows dashes.
export const { row: resourceQuotaRow, rows: resourceQuotaRows, searchText: resourceQuotaSearchText } = rowModel(
  (host): ResourceQuotaRow => {
    const quota = resourceQuotaObject(host);
    return { ...identityOf(host, quota, false), request: piecesOf(quota, 'requests.'), limit: piecesOf(quota, 'limits.') };
  },
  (row) => [row.name, row.namespace, ...(row.request ?? []), ...(row.limit ?? [])],
);
