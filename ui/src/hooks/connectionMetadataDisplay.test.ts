import { describe, expect, it } from 'vitest';
import type { ConnectionMetadataSnapshot } from '@omniviewdev/runtime';
import { connectionMetadataDisplay } from './connectionMetadataDisplay';

describe('connection metadata display', () => {
  const snapshot: ConnectionMetadataSnapshot = { connectionID: 'a', generation: '1', revision: '1', active: true, refreshing: false, entries: {
    'kubernetes.server_version': { state: 'current', value: 'v1.34', observedAt: '2026-10-31T10:00:00Z' },
    'kubernetes.server_platform': { state: 'unavailable', error: { code: 'DENIED', message: 'Not reported' } },
  } };
  it('keeps successful, unavailable, and unobserved facts distinct', () => {
    const version = connectionMetadataDisplay(snapshot, true, 'kubernetes.server_version');
    expect(version.state).toBe('current');
    expect(version.value).toBe('v1.34');
    expect(connectionMetadataDisplay(snapshot, true, 'kubernetes.server_platform').state).toBe('unavailable');
    expect(connectionMetadataDisplay(snapshot, true, 'kubernetes.server_url').state).toBe('unobserved');
  });
  it('retains the value but invalidates freshness on disconnect or transport loss', () => {
    for (const [source, transport] of [[snapshot, false], [{ ...snapshot, active: false }, true]] as const) {
      const version = connectionMetadataDisplay(source, transport, 'kubernetes.server_version');
      expect(version.state).toBe('stale');
      expect(version.value).toBe('v1.34');
    }
    expect(connectionMetadataDisplay(undefined, true, 'kubernetes.server_version').state).toBe('unobserved');
  });
});
