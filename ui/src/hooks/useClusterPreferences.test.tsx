import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionGroup } from '../types/clusters';

const store = vi.hoisted(() => ({ groups: [] as ConnectionGroup[], write: vi.fn() }));
vi.mock('@omniviewdev/runtime', () => ({ usePluginData: (_plugin: string, key: string, fallback: unknown) => ({
  data: key === 'cluster_groups' ? store.groups : fallback,
  isLoading: false,
  // Match runtime's unstable update identity; rendering must not trigger writes.
  update: async (value: unknown) => { if (key === 'cluster_groups') await store.write(value); },
}) }));
import { useClusterPreferences } from './useClusterPreferences';

describe('folder metadata migration persistence', () => {
  beforeEach(() => {
    store.groups = [{ id: 'owned', name: 'Old', connectionIds: [], ruleSet: { logic: 'and', rules: [
      { id: 'rule', field: 'data:k8s_version', operator: 'equals', value: 'v1.34' },
    ] } }];
    store.write.mockReset();
  });
  it('has no pending old migration that can overwrite a subsequent explicit edit', async () => {
    const { result, rerender } = renderHook(() => useClusterPreferences('kubernetes'));
    expect(store.write).not.toHaveBeenCalled();
    expect(result.current.customGroups[0].ruleSet!.rules[0].field).toBe('metadata:kubernetes.server_version');
    rerender();
    expect(store.write).not.toHaveBeenCalled();
    await act(async () => { await result.current.updateGroup('owned', { name: 'New' }); });
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(store.write.mock.calls[0][0][0]).toMatchObject({ name: 'New', ruleSet: { rules: [{ field: 'metadata:kubernetes.server_version' }] } });
    rerender();
    expect(store.write).toHaveBeenCalledTimes(1);
  });
  it('propagates persistent write failure without an automatic retry or render loop', async () => {
    store.write.mockRejectedValue(new Error('persistence unavailable'));
    const { result, rerender } = renderHook(() => useClusterPreferences('kubernetes'));
    await act(async () => {
      await expect(result.current.updateGroup('owned', { name: 'New' })).rejects.toThrow('persistence unavailable');
    });
    for (let index = 0; index < 5; index++) rerender();
    expect(store.write).toHaveBeenCalledTimes(1);
  });
});
