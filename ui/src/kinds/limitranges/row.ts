import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import { limitRangeObject } from './object';

/** What the list holds of one LimitRange. A field the object does not hold is undefined. */
export type LimitRangeRow = KindRow & {
  /** How many entries `spec.limits` has: the mock's Items. A LimitRange that states no list has none, and an empty list is 0. */
  readonly items: number | undefined;
  /** The type each entry limits, once each and in the order of the entries: the mock's Types. An entry that states none names none, and a LimitRange that names none has none. */
  readonly types: readonly string[] | undefined;
};

// The LimitRanges' rows: one per record object, computed once (`../rows.ts`). kubectl prints only a name and the time the object was made (its printer has no AGE: the mock calls the same time Age, K60.1), so
// both fields are read from `spec.limits`. An object that has no spec, a spec with no `limits` and a body that is not an object say nothing of its items: the list shows dashes, and no zero is made up.
export const { row: limitRangeRow, rows: limitRangeRows, searchText: limitRangeSearchText } = rowModel(
  (host): LimitRangeRow => {
    const limitRange = limitRangeObject(host);
    const limits = limitRange.spec?.limits;
    const types = [...new Set((limits ?? []).flatMap(({ type }) => (type === undefined || type === '' ? [] : [type])))];
    return { ...identityOf(host, limitRange, false), items: limits?.length, types: types.length === 0 ? undefined : types };
  },
  (row) => [row.name, row.namespace, row.items?.toString(), ...(row.types ?? [])],
);
