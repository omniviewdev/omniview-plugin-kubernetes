import type { ConnectionMetadataSnapshot } from '@omniviewdev/runtime';

export type ConnectionMetadataDisplay = {
  value: string;
  state: 'current' | 'stale' | 'unavailable' | 'unobserved';
  detail: string;
};

/** Keep observation detail separate from the value shown in compact surfaces. */
export function connectionMetadataDisplay(snapshot: ConnectionMetadataSnapshot | undefined, transportAvailable: boolean, key: string): ConnectionMetadataDisplay {
  const entry = snapshot?.entries[key];
  if (!entry) return { value: '—', state: 'unobserved', detail: 'No observation yet.' };
  if (entry.state === 'unavailable') {
    return { value: '—', state: 'unavailable', detail: entry.error.message };
  }
  if (typeof entry.value !== 'string') {
    return { value: '—', state: 'unavailable', detail: 'The server returned an unexpected value.' };
  }
  const stale = !transportAvailable || !snapshot.active || entry.state === 'stale';
  const observed = new Date(entry.observedAt);
  const timestamp = Number.isNaN(observed.getTime())
    ? 'Observation time unavailable.'
    : `Observed ${observed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`;
  return {
    value: entry.value,
    state: stale ? 'stale' : 'current',
    detail: stale
      ? `${entry.state === 'stale' && entry.error ? entry.error.message : 'Saved value; not currently verified.'} ${timestamp}`
      : timestamp,
  };
}
