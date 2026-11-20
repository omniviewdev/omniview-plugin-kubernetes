import type { AgeFormatter } from '@omniviewdev/kit';

import type { ObjectMeta } from './object';

// What a list says of an object that every kind says the same way, derived from the object a cluster served (docs/ui-next/slices/1a-pods-list.md 1.3). A value the object does not hold
// is undefined: the cell draws a dash with its reason, never 0, an empty string or a word (ch13 D7).

/** A timestamp the API wrote, as epoch milliseconds; undefined when there is none or it is not a time. */
export function timeOf(timestamp: string | undefined): number | undefined {
  const time = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
  return Number.isNaN(time) ? undefined : time;
}

/** `metadata.creationTimestamp` as epoch milliseconds. */
export function createdAt(object: { readonly metadata?: ObjectMeta }): number | undefined {
  return timeOf(object.metadata?.creationTimestamp);
}

/** How many trailing characters ("-7x5nx") a cell keeps whole when it has to cut a generated name; 0 when the name has no such tail. */
export function nameTail(name: string): number {
  return /-[a-z0-9]{1,10}$/.exec(name)?.[0].length ?? 0;
}

export type Age = {
  /** One unit, rounded down: `42s`, `5m`, `3h`, `17d`; `in 5m` when the cluster's clock is ahead. */
  readonly text: string;
  /** The absolute time and the words, for the tip: `2026-11-01 09:00 UTC · 3 days ago`. */
  readonly long: string;
};

const counted = (value: number, word: string) => `${value} ${word}${value === 1 ? '' : 's'}`;

function compactAge(seconds: number): string {
  if (seconds >= 86400) {
    return `${Math.floor(seconds / 86400)}d`;
  }

  if (seconds >= 3600) {
    return `${Math.floor(seconds / 3600)}h`;
  }

  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}m`;
  }

  return `${Math.max(0, Math.floor(seconds))}s`;
}

function words(seconds: number): string {
  if (seconds < 3600) {
    return counted(Math.max(1, Math.floor(seconds / 60)), 'minute');
  }

  if (seconds < 86400) {
    return counted(Math.floor(seconds / 3600), 'hour');
  }

  if (seconds < 86400 * 60) {
    return counted(Math.floor(seconds / 86400), 'day');
  }

  if (seconds < 86400 * 730) {
    return counted(Math.floor(seconds / 86400 / 30), 'month');
  }

  return counted(Math.floor(seconds / 86400 / 365), 'year');
}

/** The age of an object as the mock draws it (MOCK k8s-resource-definitions.js `Cell.age`): one unit in the cell, the exact time in the tip. */
export function formatAge(createdAt: number, now: number): Age {
  const delta = (now - createdAt) / 1000;
  const seconds = Math.abs(delta);
  const stamp = `${new Date(createdAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  if (delta < 0) {
    return { text: `in ${compactAge(seconds)}`, long: `${stamp} · ${seconds < 60 ? 'now' : `in ${words(seconds)}`}` };
  }

  return { text: compactAge(seconds), long: `${stamp} · ${seconds < 60 ? 'just now' : `${words(seconds)} ago`}` };
}

const SPAN_UNITS: ReadonlyArray<readonly [size: number, name: string]> = [[86400, 'd'], [3600, 'h'], [60, 'min'], [1, 's']];

/** A span of seconds as the mock says it (`spanText`, K61.1: human units, two of them at most): `7 s`, `6 min 12 s`, `1 h 2 min`, `3 d`. */
export function spanText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  // The largest unit the span reaches (seconds for none, so 0 reads `0 s`), and the one below it for the remainder.
  const found = SPAN_UNITS.findIndex(([size]) => total >= size);
  const at = found === -1 ? SPAN_UNITS.length - 1 : found;
  const [size, name] = SPAN_UNITS[at];
  const below = SPAN_UNITS[at + 1];
  const rest = below === undefined ? 0 : Math.floor((total % size) / below[0]);
  return `${Math.floor(total / size)} ${name}${rest === 0 || below === undefined ? '' : ` ${rest} ${below[1]}`}`;
}

/**
 * The time since a start, as `spanText` says it, for the page's one age clock (`useAge`): the label changes each second below an hour, each minute below a day and each hour after,
 * and `changesAt` says exactly when. A start in the future reads `0 s` until it comes.
 */
export const spanSince: AgeFormatter = (date, now) => {
  const start = date.getTime();
  const elapsed = Math.floor((now - start) / 1000);
  if (elapsed < 0) {
    return { text: spanText(0), changesAt: start };
  }

  const step = elapsed < 3600 ? 1 : elapsed < 86400 ? 60 : 3600;
  return { text: spanText(elapsed), changesAt: start + (Math.floor(elapsed / step) + 1) * step * 1000 };
};

const grouped = (value: number): string => Math.round(value).toLocaleString('en-US');
const oneDecimal = (value: number): string => String(Number(value.toFixed(1)));

/** A size as the mock says it (`bytesText`, K61.1): bytes below a KiB, then a whole number of KiB and MiB with thousands grouped, then GiB and TiB with one decimal (`1,558 MiB`, `32 GiB`). */
export function bytesText(bytes: number): string {
  const magnitude = Math.abs(bytes);
  if (magnitude >= 1024 ** 4) {
    return `${oneDecimal(bytes / 1024 ** 4)} TiB`;
  }

  if (magnitude >= 1024 ** 3) {
    return `${oneDecimal(bytes / 1024 ** 3)} GiB`;
  }

  if (magnitude >= 1024 ** 2) {
    return `${grouped(bytes / 1024 ** 2)} MiB`;
  }

  return magnitude >= 1024 ? `${grouped(bytes / 1024)} KiB` : `${grouped(bytes)} B`;
}

/** The first `max` names of a list, the number of the rest (`a, b, c +2`), and the whole list for the tip when the text is not all of it (the mock's `listText`). */
export function namesText(names: readonly string[], max: number): { readonly text: string; readonly tip?: string } {
  return names.length > max ? { text: `${names.slice(0, max).join(', ')} +${names.length - max}`, tip: names.join(', ') } : { text: names.join(', ') };
}
