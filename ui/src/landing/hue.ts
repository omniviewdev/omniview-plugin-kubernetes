import type { DataColor } from '@omniviewdev/kit';

// The hue of a connection, which its tile on the pages and its row in the sidebar both wear, so that one connection is one colour wherever it is drawn. The kit's `Avatar` takes one from the name when it is given no colour
// (`Avatar.tsx`, `toneOf`, which it does not export), and the sidebar's `tone` is a colour of the same palette: this is the kit's rule, written once, and `hue.test.ts` holds it to the kit's by drawing the Avatar.

/**
 * The hues of the kit's data palette that a name can take, in the kit's order: blue, purple, cyan and gray. Green, amber and red are left out, as the kit leaves them out: they are the colours of a state (healthy,
 * attention, error), and a connection that is drawn green is not a connection that is healthy.
 */
const HUES = ['blue', 'purple', 'cyan', 'gray'] as const satisfies readonly DataColor[];

/** The hue of a name: a hash of its code points, so that the same name is the same hue on every screen. */
export function hueOf(name: string): DataColor {
  let hash = 7;
  for (const character of name.trim()) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }

  return HUES[hash % HUES.length] ?? 'blue';
}
