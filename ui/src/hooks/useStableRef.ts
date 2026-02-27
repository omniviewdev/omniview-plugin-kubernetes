import { useState } from 'react';

/**
 * Returns a stable object reference that only changes when any of its
 * top-level values actually differ (shallow comparison). This prevents
 * unnecessary re-renders when upstream state objects are reconstructed
 * with identical content.
 */
export function useStableObject<T extends Record<string, unknown> | undefined>(value: T): T {
  const [stable, setStable] = useState(value);

  // React allows calling setState during render to derive state.
  // Update only when the incoming value is shallowly different.
  if (!shallowEqual(stable, value)) {
    setStable(value);
  }

  // If we just called setStable, React will re-render with the new value.
  // Until then, return whichever is current: if they're equal, `stable`
  // is already correct; if not, we return the new `value` directly so
  // the caller sees the updated reference on this render.
  return shallowEqual(stable, value) ? stable : value;
}

function shallowEqual<T extends Record<string, unknown> | undefined>(a: T, b: T): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
