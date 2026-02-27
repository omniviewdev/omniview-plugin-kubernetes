import { useRef } from 'react';

/**
 * Returns a stable object reference that only changes when any of its
 * top-level values actually differ (shallow comparison). This prevents
 * unnecessary re-renders when upstream state objects are reconstructed
 * with identical content.
 */
export function useStableObject<T extends Record<string, unknown> | undefined>(value: T): T {
  const ref = useRef(value);

  if (!shallowEqual(ref.current, value)) {
    ref.current = value;
  }

  return ref.current;
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
