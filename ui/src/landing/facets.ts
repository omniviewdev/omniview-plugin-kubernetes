import type { ConnectionRow } from './model';

// What the page of all the connections narrows and groups by besides the state: the platform and the region a connection's labels state (`facts.ts`). They are read from the rows alone, so every connection has its
// value at once and none is read by connecting; a connection whose labels say nothing has none, and is in no value of a facet.

/** The facts a facet is made of. */
export type FacetKey = 'platform' | 'region';

/** One value a fact takes among the connections, and how many of them have it. */
export type FacetOption = { readonly value: string; readonly count: number };

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** The values a fact takes among the rows, in the order of the words, each with the number of rows that have it. A row that has none is in no option. */
export function facetOptions(rows: readonly Pick<ConnectionRow, FacetKey>[], key: FacetKey): readonly FacetOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key];
    if (value !== undefined) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  return [...counts].sort(([a], [b]) => collator.compare(a, b)).map(([value, count]) => ({ value, count }));
}

/**
 * Whether the connections state a fact for most of them: more than half. A facet of a fact that few of them state would be a filter that hides most connections to show a few, so it is drawn only where the data fills it
 * (the region is stated for a cloud's clusters and for no local one: a kubeconfig of EKS contexts has one, and one of kind clusters has not).
 */
export function statedForMost(rows: readonly Pick<ConnectionRow, FacetKey>[], key: FacetKey): boolean {
  return rows.filter((row) => row[key] !== undefined).length * 2 > rows.length;
}

/** What the cards of a platform are headed by, and the heading of the connections whose labels do not say a platform (the mock's word for a fact that is not known). */
export const NOT_DETECTED = 'Not detected';

/** A titled run of the cards: the platform's words, the rows that run on it. */
export type PlatformGroup = { readonly id: string; readonly title: string; readonly rows: readonly ConnectionRow[] };

/**
 * The rows in groups by platform, in the order of the words with the connections that state none last, when more than one platform is present among them; undefined when it is not (a single heading over every card
 * says nothing, and one platform beside connections that state none is not a choice between platforms). The rows keep their order inside a group.
 */
export function groupsOf(rows: readonly ConnectionRow[]): readonly PlatformGroup[] | undefined {
  const named = facetOptions(rows, 'platform');
  if (named.length < 2) {
    return undefined;
  }

  const groups: PlatformGroup[] = named.map(({ value }) => ({ id: `platform:${value}`, title: value, rows: rows.filter((row) => row.platform === value) }));
  const unknown = rows.filter((row) => row.platform === undefined);
  return unknown.length === 0 ? groups : [...groups, { id: 'platform:none', title: NOT_DETECTED, rows: unknown }];
}
