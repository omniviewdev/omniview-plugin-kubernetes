import { useSyncExternalStore } from 'react';

export type ManifestMode = 'form' | 'yaml';
export const MANIFEST_MODE_KEY = 'omniview.kubernetes.manifest-editor.mode';
const listeners = new Set<() => void>();
let memoryPreference: ManifestMode | undefined;

function storedMode(): ManifestMode {
  if (memoryPreference) return memoryPreference;
  try {
    const stored = window.localStorage.getItem(MANIFEST_MODE_KEY);
    if (stored === 'form' || stored === 'yaml') return stored;
  } catch {
    // Embedded browser storage may be unavailable. Keep the in-memory choice.
  }
  return memoryPreference ?? 'form';
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === MANIFEST_MODE_KEY || event.key === null) {
      memoryPreference = undefined;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setManifestMode(mode: ManifestMode) {
  memoryPreference = mode;
  try {
    window.localStorage.setItem(MANIFEST_MODE_KEY, mode);
  } catch {
    // Notify every mounted editor even when persistence is blocked.
  }
  listeners.forEach((listener) => listener());
}

export function useManifestMode(): readonly [ManifestMode, typeof setManifestMode] {
  const mode = useSyncExternalStore(subscribe, storedMode, () => 'form' as const);
  return [mode, setManifestMode] as const;
}
