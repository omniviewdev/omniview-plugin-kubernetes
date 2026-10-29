import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const getSnapshot = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  if (listeners.size === 0 && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', notify);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', notify);
    }
  };
}

/** One document listener, shared by mounted consumers. Reads visibility on first render. */
export function useDocumentVisibility() {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
