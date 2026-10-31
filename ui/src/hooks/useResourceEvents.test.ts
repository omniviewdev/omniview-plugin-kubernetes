import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useResourceEvents } from './useResourceEvents';

const read = vi.hoisted(() => vi.fn());
vi.mock('./useKubernetesResources', () => ({ useKubernetesResources: read }));

describe('native resource event matching', () => {
  it('matches exact native kind, name and namespace rather than display labels', () => {
    read.mockReturnValue({ isLoading: false, bodies: [
      { involvedObject: { kind: 'Pod', name: 'same', namespace: 'team' }, message: 'selected' },
      { involvedObject: { kind: 'Pod', name: 'same', namespace: 'other' }, message: 'wrong namespace' },
      { involvedObject: { kind: 'Pods', name: 'same', namespace: 'team' }, message: 'display label' },
      { involvedObject: { kind: 'Deployment', name: 'same', namespace: 'team' }, message: 'wrong kind' },
    ] });
    const { result } = renderHook(() => useResourceEvents({
      pluginID: 'kubernetes', connectionID: 'selected', nativeKind: 'Pod', resourceName: 'same', namespace: 'team',
    }));
    expect(result.current.events.map((event) => event.message)).toEqual(['selected']);
    expect(read).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'k8s:/events', namespaces: ['team'], enabled: true,
    }));
  });

  it('does not read events without native kind evidence', () => {
    read.mockReturnValue({ isLoading: false, bodies: [] });
    const { result } = renderHook(() => useResourceEvents({
      pluginID: 'kubernetes', connectionID: 'selected', nativeKind: '', resourceName: 'same', namespace: 'team',
    }));
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    expect(result.current.events).toEqual([]);
  });

  it('keeps every matching collection event and exposes request recovery', () => {
    const retry = vi.fn();
    const error = new Error('Events unavailable');
    read.mockReturnValue({ isLoading: false, retry, error, bodies: Array.from({ length: 150 }, (_, index) => ({
      involvedObject: { kind: 'Pod', name: 'same', namespace: 'team' }, message: `event-${index}`,
    })) });
    const { result } = renderHook(() => useResourceEvents({
      pluginID: 'kubernetes', connectionID: 'selected', nativeKind: 'Pod', resourceName: 'same', namespace: 'team',
    }));
    expect(result.current.events).toHaveLength(150);
    expect(result.current.error).toBe(error);
    result.current.retry();
    expect(retry).toHaveBeenCalledOnce();
  });
});
