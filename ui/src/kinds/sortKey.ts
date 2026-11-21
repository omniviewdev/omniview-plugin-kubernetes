import type { DataTableColumn } from '@omniviewdev/kit';

import type { KindField, KindRow, Ratio, SortKind, SortValue } from './definition';

// How the table sorts a kind's column, as the data of the kind's definition says it: the column's `sort` (the mock's comparison, MOCK k8s-resources.js `compareBy`) and its field's `sortValue` (what the
// column compares by). The kit's table sorts by ONE key a row, text in natural order or a number, a stable sort in which a row with no key (`undefined`) is last in either direction and a tie keeps the order
// the rows were given in. So each comparison of the mock is a key:
//
//   text    the word as text, in natural order (`pod-2` before `pod-10`: the mock's `localeCompare(..., { numeric: true })`); an empty word is a missing value, as the mock's `missing()` has it
//   number  a number as a number (9 before 10)
//   time    the instant, in epoch milliseconds, ascending is the oldest first (the mock's `Date.parse(a) - Date.parse(b)`)
//   ratio   `ready/total` by its fraction (a total of 0 is whole, `x[1] ? x[0] / x[1] : 1`), ascending is the unhealthiest first, and a tie of fractions by the total, ascending (`|| x[1] - y[1]`)

/** The fraction a ratio compares by: a total of 0 is whole. */
const fraction = ({ ready, total }: Ratio): number => (total === 0 ? 1 : ready / total);

/**
 * The size of a total in a ratio's key. The key is the fraction and, a step below it, the total: two fractions of totals up to `MAX_TOTAL` differ by at least 1/MAX_TOTAL^2 = 1e-8, and the most the totals add
 * is MAX_TOTAL * TOTAL_STEP = 1e-9, so the fraction decides whenever the fractions differ, and the total decides a tie of them. A total beyond MAX_TOTAL counts as MAX_TOTAL (no kind has a ratio that large: the
 * widest is a Job's completions).
 */
export const MAX_TOTAL = 10_000;
export const TOTAL_STEP = 1e-13;

/** A ratio as the number the table sorts it by. */
export const ratioKey = (ratio: Ratio): number => fraction(ratio) + Math.min(ratio.total, MAX_TOTAL) * TOTAL_STEP;

const word = (value: SortValue): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const count = (value: SortValue): number | undefined => (typeof value === 'number' ? value : undefined);

const ratio = (value: SortValue): number | undefined => (typeof value === 'object' ? ratioKey(value) : undefined);

/** The table's sort key and kind for a column that compares as `kind` and compares by `sortValue`. */
export function tableSort<TRow extends KindRow>(kind: SortKind, sortValue: KindField<TRow>['sortValue']): Pick<DataTableColumn<TRow>, 'sortKey' | 'sortKind'> {
  switch (kind) {
    case 'text':
      return { sortKey: (row) => word(sortValue(row)), sortKind: 'text' };
    case 'number':
    case 'time':
      return { sortKey: (row) => count(sortValue(row)), sortKind: 'number' };
    case 'ratio':
      return { sortKey: (row) => ratio(sortValue(row)), sortKind: 'number' };
  }
}

/** The sort the list opens in, as the host's list page says it: a column and a direction in the table's words. */
export const tableDefaultSort = ({ id, direction }: { readonly id: string; readonly direction: 'asc' | 'desc' }): { readonly column: string; readonly direction: 'ascending' | 'descending' } => ({
  column: id,
  direction: direction === 'desc' ? 'descending' : 'ascending',
});
