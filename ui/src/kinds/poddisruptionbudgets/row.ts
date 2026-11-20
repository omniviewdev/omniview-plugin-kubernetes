import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import { podDisruptionBudgetObject } from './object';

/** What the list holds of one PodDisruptionBudget. A field the object does not hold is undefined. */
export type PodDisruptionBudgetRow = KindRow & {
  /** `status.disruptionsAllowed`: kubectl's ALLOWED DISRUPTIONS. A budget the controller has not written a status for says nothing. */
  readonly allowed: number | undefined;
};

// The PodDisruptionBudgets' rows: one per record object, computed once (`../rows.ts`). The API always writes the number once the budget has a status, and a budget that allows none says 0; an object with no
// status, and a body that is not an object, say nothing of it: the list shows a dash, and no zero is made up.
export const { row: podDisruptionBudgetRow, rows: podDisruptionBudgetRows, searchText: podDisruptionBudgetSearchText } = rowModel(
  (host): PodDisruptionBudgetRow => {
    const budget = podDisruptionBudgetObject(host);
    return { ...identityOf(host, budget, false), allowed: budget.status?.disruptionsAllowed };
  },
  (row) => [row.name, row.namespace, row.allowed?.toString()],
);
