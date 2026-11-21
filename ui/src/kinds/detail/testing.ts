import type { StatusSummaryItem } from '@omniviewdev/kit';

import type { CapturedObject } from '../testing';

import type { DetailValue, KindOverview } from './overview';

// Test support only: nothing in the pages imports this file. The goldens of the detail pages (`hack/kinds-capture/capture-detail.mjs`): each kind's fixture is every object of a real cluster as
// `kubectl get -o json` prints it, and, beside it, what `kubectl describe` prints of it. A test holds a page's Details rows to the object field for field, and to `describe` where a row is a derived value.

export type DetailCapture<TObject extends CapturedObject = CapturedObject> = {
  /** The server's clock when the fixture was captured. */
  readonly serverDate: string;
  readonly objects: ReadonlyArray<{ readonly object: TObject; readonly describe?: string }>;
};

/** The detail fixture of a kind, from the text of its file (`fixtures/<kind>-detail.json`, which the test reads). `TObject` is the part of the object a test reads, as the test says it. */
export function parseDetailFixture<TObject extends CapturedObject = CapturedObject>(json: string): DetailCapture<TObject> {
  // The fixture is a file this repository holds, made by capture-detail.mjs: its shape is the test's to state, not something to check at run time.
  const capture = JSON.parse(json) as DetailCapture<TObject>;
  return capture;
}

/** A value of the Details card as a person reads it, in text: chips as `key=value`, a link or a moment by its words. */
export function valueText(value: DetailValue): string {
  switch (value.kind) {
    case 'text': return value.text;
    case 'tags': return value.items.map((item) => (item.value === undefined ? item.key : `${item.key}=${item.value}`)).join(', ');
    case 'ref': return value.text;
    case 'moment': return `at ${new Date(value.at).toISOString()}`;
    case 'running': return `since ${new Date(value.since).toISOString()}`;
  }
}

/** The Details card as label and text, in the order the page draws it. */
export function rowsOf(overview: KindOverview): ReadonlyArray<readonly [label: string, text: string]> {
  return overview.details.map((fact) => [fact.label, valueText(fact.value)] as const);
}

/** The summary line as a person reads it: `3/3 ready`, `up to date`. */
export function summaryText(items: readonly StatusSummaryItem[]): readonly string[] {
  return items.map((item) => ('status' in item ? item.status.label : 'value' in item ? `${item.value}${item.label === undefined ? '' : ` ${item.label}`}` : item.text));
}

/**
 * What `kubectl describe` prints at the top level of an object: `Name:   value`, with the value continued on the lines that follow it, indented under it (`Labels:` and `Annotations:` do this). The
 * first line of each field is the field; a field that is nested in a section (`Pod Template:`) is not at the top level, so it is not here.
 */
export function describedFields(describe: string): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();
  for (const line of describe.split('\n')) {
    const match = /^([A-Z][A-Za-z -]*?):\s+(.*)$/.exec(line);
    if (match?.[1] !== undefined && !fields.has(match[1])) {
      fields.set(match[1], match[2] ?? '');
    }
  }

  return fields;
}

/** The lines of a nested section of `describe`, by the name of its heading (`Pod Template:`), up to the next heading at the top level. */
export function describedSection(describe: string, heading: string): readonly string[] {
  const lines = describe.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${heading}:`));
  if (start === -1) {
    return [];
  }

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).map((line) => line.trim());
}
