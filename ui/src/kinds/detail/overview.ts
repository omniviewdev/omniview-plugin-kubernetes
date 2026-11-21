import type { StatusSummaryItem, TagItem } from '@omniviewdev/kit';
import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import type { KindStatus } from '../status';

import type { ConditionRow } from './conditions';
import type { TagModel } from './metadata';

// What the page of ONE object says of it, as plain data: the shape of the mock's `overview(record)` (MOCK k8s-resource-definitions.js: `{ state, summary, facts, sections }`; K59). A kind's
// definition answers it for the record of an object (`KindDetail.overview`), and the ONE generic page draws it (`view.tsx`), knowing no kind. It is a pure function of the record and carries no clock: a
// moment is an instant, which the view keeps current. A section that has nothing to say is empty, and the page does not draw it.

/** An object another object refers to: its kind as the API spells it (`CronJob`), its name and, for a kind that lives in a namespace, its namespace. */
export type ObjectRef = {
  readonly kind: string;
  readonly name: string;
  readonly namespace?: string | undefined;
};

/** What the value of a row of the Details card is. A `ref` is drawn as a link when the plugin has a page for the kind it names, and as plain text when it has none: no link goes nowhere. */
export type DetailValue =
  | { readonly kind: 'text'; readonly text: string; readonly mono?: true; readonly tip?: string }
  | { readonly kind: 'tags'; readonly items: readonly TagItem[] }
  | { readonly kind: 'ref'; readonly ref: ObjectRef; readonly text: string }
  /** An instant, drawn as the time since, kept current, with the instant in the tip. */
  | { readonly kind: 'moment'; readonly at: number }
  /** The time since a start that has not ended, kept current. */
  | { readonly kind: 'running'; readonly since: number };

/** One name and value of the Details card. A `wide` row spans both columns. */
export type DetailFact = {
  readonly id: string;
  readonly label: string;
  readonly value: DetailValue;
  readonly wide?: true;
};

export type KindOverview = {
  /** The header's chip: the platform's word and its role, from the same table as the lists. The kind says none when the object does not say its state. */
  readonly state: KindStatus | undefined;
  /** Epoch milliseconds: what the header's age counts from. */
  readonly createdAt: number | undefined;
  /** The one line that leads the first screen, WITHOUT the state: the chip says it. */
  readonly summary: readonly StatusSummaryItem[];
  readonly details: readonly DetailFact[];
  readonly conditions: readonly ConditionRow[];
  readonly labels: readonly TagModel[];
  readonly annotations: readonly TagModel[];
};

type FactOptions = { readonly wide?: true };

/** A row of text: `mono` for an address or an identifier, `tip` for the whole when the text is a short form of it. Nothing for text that is missing or empty. */
export function textFact(id: string, label: string, text: string | undefined, { mono, tip, wide }: FactOptions & { readonly mono?: true; readonly tip?: string } = {}): DetailFact | undefined {
  if (text === undefined || text === '') {
    return undefined;
  }

  return { id, label, value: { kind: 'text', text, ...(mono === true ? { mono } : {}), ...(tip === undefined ? {} : { tip }) }, ...(wide === true ? { wide } : {}) };
}

/** A row of chips (a selector). Nothing for none. */
export function tagsFact(id: string, label: string, items: readonly TagItem[], { wide }: FactOptions = {}): DetailFact | undefined {
  return items.length === 0 ? undefined : { id, label, value: { kind: 'tags', items }, ...(wide === true ? { wide } : {}) };
}

/** A row that names another object. `text` is what it is drawn with: the kind and the name (`CronJob nightly`) unless given. Nothing for an object that is not named. */
export function refFact(id: string, label: string, ref: ObjectRef | undefined, { text, wide }: FactOptions & { readonly text?: string } = {}): DetailFact | undefined {
  return ref === undefined ? undefined : { id, label, value: { kind: 'ref', ref, text: text ?? `${ref.kind} ${ref.name}` }, ...(wide === true ? { wide } : {}) };
}

/** A row with an instant. Nothing for one the object does not state. */
export function momentFact(id: string, label: string, at: number | undefined): DetailFact | undefined {
  return at === undefined ? undefined : { id, label, value: { kind: 'moment', at } };
}

/** A row with the time since a start that has not ended. Nothing for a start the object does not state. */
export function runningFact(id: string, label: string, since: number | undefined): DetailFact | undefined {
  return since === undefined ? undefined : { id, label, value: { kind: 'running', since } };
}

/** The rows that exist, in the order given. */
export function facts(...rows: ReadonlyArray<DetailFact | undefined>): readonly DetailFact[] {
  return rows.filter((row): row is DetailFact => row !== undefined);
}

/**
 * A kind's overview of a record, built once per record OBJECT, never in render: the source view keeps every unchanged record as the same object, so a live update reads only what changed, and a page
 * that renders again reads nothing again (the way `rowModel` holds a list's rows, `../rows.ts`).
 */
export function overviewModel(build: (host: HostRecord) => KindOverview): (host: HostRecord) => KindOverview {
  const overviews = new WeakMap<HostRecord, KindOverview>();
  return (host) => {
    let found = overviews.get(host);
    if (found === undefined) {
      found = build(host);
      overviews.set(host, found);
    }

    return found;
  };
}
