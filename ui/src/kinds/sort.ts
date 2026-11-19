import type { KindField, KindRow, KindSort, SortValue } from './definition';

// Sorting as the mock does it (MOCK k8s-resources.js:387-421): the column's kind picks the comparison, a missing value is always last whatever the direction, and a tie is broken by the host
// key, ascending. What a column compares by is its field's `sortValue`.

// Digits compare as numbers: pod-2 before pod-10, 10.0.0.9 before 10.0.0.10.
const collator = new Intl.Collator(undefined, { numeric: true });

const isMissing = (value: SortValue): boolean => value === undefined || value === '';
const fraction = (value: { readonly ready: number; readonly total: number }) => (value.total === 0 ? 1 : value.ready / value.total);

function compare(a: NonNullable<SortValue>, b: NonNullable<SortValue>): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  if (typeof a === 'string' && typeof b === 'string') {
    return collator.compare(a, b);
  }

  if (typeof a === 'object' && typeof b === 'object') {
    return fraction(a) - fraction(b) || a.total - b.total;
  }

  return 0;
}

/**
 * The rows in the order of `sort`; the input is not touched. A missing value is last whatever the direction, and a tie is broken
 * by the host key, ascending (the mock's rule).
 */
export function sortRows<TRow extends KindRow>(fields: ReadonlyArray<KindField<TRow>>, rows: readonly TRow[], { id, direction }: KindSort): readonly TRow[] {
  const field = fields.find((candidate) => candidate.id === id);
  if (field === undefined) {
    throw new Error(`The kind has no field ${id} to sort by`);
  }

  const sign = direction === 'desc' ? -1 : 1;
  const keyed = rows.map((row) => ({ row, value: field.sortValue(row) }));
  keyed.sort((a, b) => {
    const missingA = isMissing(a.value);
    const missingB = isMissing(b.value);
    if (missingA || missingB) {
      return missingA && missingB ? a.row.key.localeCompare(b.row.key) : missingA ? 1 : -1;
    }

    return compare(a.value!, b.value!) * sign || a.row.key.localeCompare(b.row.key);
  });
  return keyed.map(({ row }) => row);
}
