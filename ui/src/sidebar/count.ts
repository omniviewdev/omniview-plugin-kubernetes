import type { Count } from '@omniviewdev/runtime/ui/v1';

import type { ShellCount } from '../contract/shell';

// What a source page says it holds (`sourcePage.count`, the plugin's Q1) and what the sidebar's entry draws for it. The entry draws a number only when it knows one: an exact count is the number, an estimate is
// the number marked approximate (the host draws it with a tilde and names it "about"), and anything else is `null`, which holds the slot with nothing in it: no dash, and no zero, for a count it does not have.

/** The counts of the sidebar's entries, by the id of the page each entry opens. An entry that is not in it has no count to draw. */
export type SidebarCounts = ReadonlyMap<string, ShellCount | null>;

/** The wire's number: an unsigned decimal with no sign, no fraction, no grouping and no leading zero. What else a string holds is not read as the nearest number. */
const CANONICAL = /^(0|[1-9]\d*)$/;

/**
 * The count a sidebar entry draws for what a page says it holds. `null`: nothing to draw yet (the page is not here, the source cannot say, the count is of a kind or a value this does not know, or
 * the number is beyond what a number holds exactly, where rounding it would make it a wrong count).
 */
export function sidebarCount(count: Count | undefined): ShellCount | null {
  if (count === undefined || (count.kind !== 'exact' && count.kind !== 'estimate')) {
    return null;
  }

  const { value } = count;
  if (value === undefined || !CANONICAL.test(value)) {
    return null;
  }

  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    return null;
  }

  return count.kind === 'exact' ? number : { value: number, approximate: true };
}
