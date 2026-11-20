import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import { ingressClassObject } from './object';

/** What the list holds of one IngressClass. A field the object does not hold is undefined. */
export type IngressClassRow = KindRow & {
  /** `spec.controller`: kubectl's CONTROLLER. */
  readonly controller: string | undefined;
  /** `<kind>/<name>` of `spec.parameters`: kubectl writes `Kind.group/name`, and the API group is never shown (K61.1). A class with no parameters has none: kubectl's PARAMETERS is `<none>`. */
  readonly parameters: string | undefined;
};

// The IngressClasses' rows: one per record object, computed once (`../rows.ts`). An IngressClass lives in no namespace, so its row has none. A class that states no controller, or no parameters, says
// nothing of them: the list shows dashes.
export const { row: ingressClassRow, rows: ingressClassRows, searchText: ingressClassSearchText } = rowModel(
  (host): IngressClassRow => {
    const ingressClass = ingressClassObject(host);
    const { controller, parameters } = ingressClass.spec ?? {};
    return {
      ...identityOf(host, ingressClass, false),
      controller,
      parameters: parameters === undefined ? undefined : `${parameters.kind}/${parameters.name}`,
    };
  },
  (row) => [row.name, row.controller, row.parameters],
);
