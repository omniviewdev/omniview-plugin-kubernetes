import type { ChipTone, IconName, KindTileTone } from '@omniviewdev/kit';
import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import type { StateRole } from './status';

// What a kind of Kubernetes object is, to the plugin's list pages: the shape of the mock's definition record (docs/ui-next/slices/1a-pods-list.md 2.4; MOCK k8s-resource-definitions.js:1053-1086;
// ch17 K60 and K61). ONE generic list page (`list.tsx`) draws any kind from its definition and reads it through ONE data hook (`useKindRows.ts`); the page and the hook know no kind, and a
// kind is added by writing its definition, not by branching in them (the plugin's CLAUDE.md: composition, never a branch on a kind in a generic component).

/** A count over a total: Ready on a Pod (containers), a Deployment (replicas) or a Job (completions). */
export type Ratio = {
  readonly ready: number;
  readonly total: number;
};

/** The closed vocabulary of cells a page draws. */
export type Cell =
  | { readonly kind: 'text'; readonly text: string; readonly mono?: true }
  /** A state: the glyph of its role beside the word. `tip` explains a state the word alone does not (Ready `1/2` on a Deployment: "1 of 2 ready"). */
  | { readonly kind: 'status'; readonly raw: string; readonly label: string; readonly role: StateRole; readonly tip?: string }
  /** The time since an object was made: `text` is the one unit at the moment of reading and the page's age clock keeps it current; `long` is the tip. */
  | { readonly kind: 'age'; readonly createdAt: number; readonly text: string; readonly long: string }
  /** The time since a start, still running: `text` is the span at the moment of reading and the page's age clock keeps it current (a Job that has not finished). */
  | { readonly kind: 'elapsed'; readonly since: number; readonly text: string }
  | { readonly kind: 'none'; readonly reason: string };

/** What every row of every kind holds: the identity the list shows and keys rows by. */
export type KindRow = {
  /** `HostRecord.key`, the host's identity of the record. Neither the name nor any field mints one. */
  readonly key: string;
  readonly name: string;
  /** Empty when the object has none. */
  readonly namespace: string;
  /** Trailing characters of the name kept whole when it is cut. */
  readonly nameTail: number;
  /** Epoch milliseconds. */
  readonly createdAt: number | undefined;
};

/** How a column compares (MOCK k8s-resources.js `compareBy`): ascending is the natural order, oldest first for time, unhealthiest first for a ratio. */
export type SortKind = 'text' | 'number' | 'ratio' | 'time';

export type SortValue = string | number | Ratio | undefined;

export type KindSort = {
  readonly id: string;
  readonly direction: 'asc' | 'desc';
};

export type KindColumn = {
  readonly id: string;
  readonly label: string;
  /** `id` is the identity column; `fixed` has the width of its format; `flex` takes what is left, measured on a sample (R9). */
  readonly fit: 'id' | 'fixed' | 'flex';
  /** Pixels: the mock's fitted width for a fixed column, the floor for a flex one. */
  readonly width: number;
  readonly align: 'left' | 'right';
  readonly sort: SortKind;
  /** In the Columns chooser, not in the list until chosen. */
  readonly defaultHidden: boolean;
  readonly required?: true;
};

/** What a column says and compares by: one per column, matched by `id`. */
export type KindField<TRow> = {
  readonly id: string;
  /** What the column sorts by. Undefined is a missing value, which is last whatever the direction. */
  readonly sortValue: (row: TRow) => SortValue;
  /** `now` is the clock the age is read against, in epoch milliseconds. */
  readonly display: (row: TRow, now: number) => Cell;
};

/** One state bucket of the strip, counted over the rows after the search. */
export type QuickFilter<TRow> = {
  readonly id: string;
  readonly label: string;
  readonly tone: ChipTone;
  readonly test: (row: TRow) => boolean;
};

export type Facet<TRow> = {
  readonly id: string;
  readonly label: string;
  /** The label of the "no choice" entry. */
  readonly all: string;
  readonly value: (row: TRow) => string | undefined;
};

/** What a kind's rows are made from: one row per record object, computed once and never in render, and what a person can read in a row for the search. */
export type RowModel<TRow> = {
  readonly row: (record: HostRecord) => TRow;
  /** The rows of a page of records, in the order of the records. The same array in gives the same array out. */
  readonly rows: (records: readonly HostRecord[]) => readonly TRow[];
  /** Everything a person can read in the row, in lower case, built the first time a search asks for it. */
  readonly searchText: (row: TRow) => string;
};

export type KindDefinition<TRow extends KindRow> = {
  /** The Kubernetes API's own naming of what the list reads: the group (empty for the core group), the preferred version, and the resource (the plural, lower case). */
  readonly identity: { readonly group: string; readonly version: string; readonly resource: string };
  /** The name the plugin's catalog gives the type: `k8s:<group>/<resource>`. It is what the data hook looks for in the catalog. */
  readonly type: string;
  /** The Kubernetes Kind, singular and as the API spells it ("Pod"): the quick filters' name ("Pod state") and the test ids of the identity cell ("pod-name"). */
  readonly kind: string;
  /** What the user calls one and many of them (K61.1): the page's heading, its tab and its sidebar entry, the footer's count. */
  readonly nouns: { readonly one: string; readonly other: string };
  /** The id of the list page that shows the kind: the key of `contributionV1.pages` and the id of its sidebar entry. */
  readonly page: string;
  /** The kind's tile, before the name in each row, and its glyph in the sidebar and the tab. The kit's registry is closed: a glyph the registry lacks is the kit's to add. */
  readonly tile: { readonly icon: IconName; readonly tone: KindTileTone };
  readonly model: RowModel<TRow>;
  readonly columns: readonly KindColumn[];
  readonly fields: ReadonlyArray<KindField<TRow>>;
  readonly list: {
    readonly defaultSort: KindSort;
    readonly identity: {
      /** The one line under the name: the namespace. */
      readonly second: (row: TRow) => string | null;
      /** Trailing characters of the name a cell keeps whole when it cuts the name. */
      readonly tail: (row: TRow) => number;
    };
    /** Counted over the rows after search, before the chosen filter (plan 1.3): the kind's own split of its state words. */
    readonly quickFilters: ReadonlyArray<QuickFilter<TRow>>;
    /** The kind's own choices beside the strip (Pods: Node). The list page does not draw them yet; a kind without any states none. */
    readonly facets?: ReadonlyArray<Facet<TRow>>;
  };
  /** The page of ONE object of the kind, when the plugin has one: the name in the list links to it. A row that names no object to open (it has no namespace) has no params. */
  readonly detail?: {
    readonly page: string;
    readonly params: (row: TRow) => Readonly<Record<string, string>> | undefined;
  };
};

/** The name the plugin's catalog gives a type: the token the Kubernetes provider derives from its group and resource. */
export function typeOf({ group, resource }: KindDefinition<KindRow>['identity']): string {
  return `k8s:${group}/${resource}`;
}

/** A column of the mock's definition record: its words, how it takes width, its width, its side and how it sorts. */
export const column = (id: string, label: string, fit: KindColumn['fit'], width: number, align: KindColumn['align'], sort: SortKind, rest: Partial<Pick<KindColumn, 'defaultHidden' | 'required'>> = {}): KindColumn =>
  ({ id, label, fit, width, align, sort, defaultHidden: false, ...rest });
