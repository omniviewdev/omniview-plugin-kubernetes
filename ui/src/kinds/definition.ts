import type { ChipTone, IconName, KindTileTone } from '@omniviewdev/kit';
import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import type { KindOverview } from './detail/overview';
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
  /** `tip` says what the cell cuts or abbreviates: the whole list behind `a, b, c +2`, the whole version behind `v1.31.4`. */
  | { readonly kind: 'text'; readonly text: string; readonly mono?: true; readonly tip?: string }
  /** A state: the glyph of its role beside the word. `tip` explains a state the word alone does not (Ready `1/2` on a Deployment: "1 of 2 ready"). */
  | { readonly kind: 'status'; readonly raw: string; readonly label: string; readonly role: StateRole; readonly tip?: string }
  /** The time since an instant: `text` is the one unit at the moment of reading and the page's age clock keeps it current; `long` is the tip. The instant is the creation of an object, or when a CronJob last ran. */
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
  /**
   * The kind's tile, before the name in each row, and its glyph in the sidebar and the tab. The kit's registry is closed: a glyph the registry lacks is the kit's to add, and a kind that waits for
   * one wears the generic tile (`GENERIC_TILE`) rather than the glyph of another kind.
   */
  readonly tile: { readonly icon: IconName; readonly tone: KindTileTone };
  readonly model: RowModel<TRow>;
  readonly columns: readonly KindColumn[];
  readonly fields: ReadonlyArray<KindField<TRow>>;
  readonly list: {
    readonly defaultSort: KindSort;
    readonly identity: {
      /** The one line under the name: the namespace of a namespaced kind, a Node's address, none for a Namespace. */
      readonly second: (row: TRow) => string | null;
      /** What the second line is, as the test id of the cell says it (`pod-namespace`, `node-address`). The namespace when absent. */
      readonly line?: 'address';
      /** Trailing characters of the name a cell keeps whole when it cuts the name. */
      readonly tail: (row: TRow) => number;
    };
    /** Counted over the rows after search, before the chosen filter (plan 1.3): the kind's own split of its state words. */
    readonly quickFilters: ReadonlyArray<QuickFilter<TRow>>;
    /** The kind's own choices beside the strip (Pods: Node). The list page does not draw them yet; a kind without any states none. */
    readonly facets?: ReadonlyArray<Facet<TRow>>;
  };
  /** The page of ONE object of the kind, when the plugin has one: the name in the list links to it, and so does every object that refers to one of the kind. A kind with none has rows that do not navigate. */
  readonly detail?: KindDetail;
};

/**
 * Which parameters of a route name one object of a kind: a kind that lives in a namespace says its namespace and its name, in that order (the order of the link's address), and a kind that lives in no
 * namespace says its name. The page reads the object by them (`detail/useKindObject.ts`), and the link to it carries them (`detailParams`).
 */
export type ObjectIdentity = readonly ['namespace', 'name'] | readonly ['name'];

/** One command of an object's header: the id it is known by, and its verb in sentence case. */
export type KindCommand = { readonly id: string; readonly label: string };

/**
 * The commands of an object's header in the one order the design allows and the mock's order for the kind (MOCK k8s-resource.js `LAYOUT`; K59): the primary one, at most two secondaries, the danger one,
 * then the items of the overflow menu. A kind's page offers them all as the kit's pattern for a command that cannot be used yet (a reason, no action): none has a backend behind it from the new UI, and
 * the status file of the step says what each needs.
 */
export type KindCommands = {
  readonly primary?: KindCommand;
  readonly secondary?: readonly KindCommand[];
  readonly danger?: KindCommand;
  readonly menu?: readonly KindCommand[];
};

/**
 * What a kind says of its page of one object, as data (the mock's `overview(record)` and `LAYOUT`): the page's id, the route parameters that name an object, and the overview of the record of one.
 * ONE generic page (`detail/page.ts`) draws any kind that has an `overview`; a kind that has none has a page of its own (the Pod's, `ui/src/pod/`), which the plugin contributes itself.
 */
export type KindDetail = {
  /** The id of the detail page of the kind: the key of `contributionV1.pages` and the `page` of the link to it. */
  readonly page: string;
  readonly identity: ObjectIdentity;
  /** What the page says of the object the record holds: its header, summary, Details rows, Conditions, Labels and Annotations. A pure function of the record. */
  readonly overview?: (record: HostRecord) => KindOverview;
  /** The commands of the header, as the mock lays them out for the kind. A function of the record, because some labels follow the object's state: Pause rollout or Resume rollout, Cordon or Uncordon. */
  readonly commands?: (record: HostRecord) => KindCommands;
};

/** The route parameters that name an object, or undefined when the object cannot be named: a kind that lives in a namespace, and an object with none to say. */
export function detailParams(identity: ObjectIdentity, object: { readonly namespace?: string | undefined; readonly name: string }): Readonly<Record<string, string>> | undefined {
  if (object.name === '') {
    return undefined;
  }

  if (identity.length === 1) {
    return { name: object.name };
  }

  return object.namespace === undefined || object.namespace === '' ? undefined : { namespace: object.namespace, name: object.name };
}

/** The name the plugin's catalog gives a type: the token the Kubernetes provider derives from its group and resource. */
export function typeOf({ group, resource }: KindDefinition<KindRow>['identity']): string {
  return `k8s:${group}/${resource}`;
}

/**
 * The tile of a kind whose glyph in the mock the kit's registry still lacks (the mock gives each kind its own: a card for a Role, a link for a RoleBinding, an archive for a StorageClass). The registry's
 * `box` is the mock's own fallback for a kind with no glyph of its own (`kindIcon`), and no other kind's glyph is taken for the missing one, so a tile never says a kind it is not. A kind wears
 * this tile until the kit has its glyph, and then names it.
 */
export const GENERIC_TILE = { icon: 'box', tone: 'blue' } as const satisfies KindDefinition<KindRow>['tile'];

/** A column of the mock's definition record: its words, how it takes width, its width, its side and how it sorts. */
export const column = (id: string, label: string, fit: KindColumn['fit'], width: number, align: KindColumn['align'], sort: SortKind, rest: Partial<Pick<KindColumn, 'defaultHidden' | 'required'>> = {}): KindColumn =>
  ({ id, label, fit, width, align, sort, defaultHidden: false, ...rest });
