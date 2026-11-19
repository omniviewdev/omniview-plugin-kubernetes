import type { Cell, Ratio } from './definition';
import { formatAge } from './fields';
import type { KindStatus } from './status';

// The cells of the closed vocabulary (`definition.ts`), made the way every kind makes them: a count in the code face and grouped, a ratio, a state with its role, an age, and a dash that says
// why where the object states nothing (ch13 D7: never 0, an empty string or a word). A kind's fields are these, applied to what its row holds.

export const none = (reason: string): Cell => ({ kind: 'none', reason });

export const mono = (text: string): Cell => ({ kind: 'text', text, mono: true });

/** A count as the mock draws a number (`Cell.mono(integerText(value))`): grouped, in the code face. */
export const countCell = (value: number | undefined, reason: string): Cell => (value === undefined ? none(reason) : mono(value.toLocaleString('en-US')));

/** A count over a total, in the code face: `2/3`. */
export const ratioCell = (ratio: Ratio | undefined, reason: string): Cell => (ratio === undefined ? none(reason) : mono(`${ratio.ready}/${ratio.total}`));

/**
 * A ratio that is watched (the mock's `watch`): below the wanted count it is a state of its own, `attention`, with the sentence in its tip, because a Deployment that wants three and
 * has one ready is not a number to read past. At the wanted count (or with none wanted) it is the plain ratio.
 */
export function watchedRatioCell(ratio: Ratio | undefined, reason: string): Cell {
  if (ratio === undefined) {
    return none(reason);
  }

  const text = `${ratio.ready}/${ratio.total}`;
  return ratio.ready < ratio.total ? { kind: 'status', raw: text, label: text, role: 'attention', tip: `${ratio.ready} of ${ratio.total} ready` } : mono(text);
}

/** A state: the glyph of its role and the platform's word; a word the table has no role for is plain text, never guessed (SR1). */
export function statusCell(status: KindStatus | undefined, reason: string): Cell {
  if (status === undefined) {
    return none(reason);
  }

  return status.role === undefined ? { kind: 'text', text: status.word } : { kind: 'status', raw: status.word, label: status.word, role: status.role };
}

export const ageCell = (createdAt: number | undefined, now: number, reason: string): Cell =>
  createdAt === undefined ? none(reason) : { kind: 'age', createdAt, ...formatAge(createdAt, now) };
