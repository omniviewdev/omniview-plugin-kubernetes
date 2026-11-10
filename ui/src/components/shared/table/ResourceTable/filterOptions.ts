import { useMemo, useState } from 'react';

import type { ToolbarFilterDef } from './index';

/** The selectable values of each toolbar filter, by the column it filters. */
export type FilterOptions = Readonly<Record<string, readonly string[]>>;

const NO_OPTIONS: FilterOptions = {};

/** The distinct values of every filter that lists its rows' values, one pass over the rows each. */
function collectValues(
  rows: readonly unknown[],
  filters: readonly ToolbarFilterDef[] | undefined,
): ReadonlyMap<string, ReadonlySet<string>> {
  const collected = new Map<string, Set<string>>();
  for (const filter of filters ?? []) {
    // The namespace dropdown lists the connection's namespaces, not the rows'.
    if (filter.columnId === 'namespace') continue;
    const values = new Set<string>();
    for (const row of rows) {
      const value = filter.accessor(row);
      if (value) values.add(value);
    }
    collected.set(filter.columnId, values);
  }
  return collected;
}

/**
 * Keeps each held option array for as long as its members stay the same, and the whole record
 * for as long as every array does. Held arrays are already sorted, so equal members are equal.
 */
function reuseOptions(
  held: FilterOptions,
  collected: ReadonlyMap<string, ReadonlySet<string>>,
): FilterOptions {
  let changed = Object.keys(held).length !== collected.size;
  const next: Record<string, readonly string[]> = {};
  for (const [columnId, values] of collected) {
    const previous = held[columnId];
    const same = previous !== undefined
      && previous.length === values.size
      && previous.every((value) => values.has(value));
    if (!same) changed = true;
    next[columnId] = same ? previous : [...values].sort();
  }
  return changed ? next : held;
}

/**
 * Options for the toolbar's value filters, from the table's complete, unfiltered collection.
 * A status-only update leaves every filter's members as they were, so it hands back the same
 * arrays and the toolbar has nothing to render. Options leave with the last row that has them.
 */
export function useFilterOptions(
  rows: readonly unknown[],
  filters: readonly ToolbarFilterDef[] | undefined,
): FilterOptions {
  const collected = useMemo(() => collectValues(rows, filters), [rows, filters]);
  const [held, setHeld] = useState<FilterOptions>(() => reuseOptions(NO_OPTIONS, collected));
  const options = reuseOptions(held, collected);
  if (options !== held) setHeld(options);
  return options;
}
