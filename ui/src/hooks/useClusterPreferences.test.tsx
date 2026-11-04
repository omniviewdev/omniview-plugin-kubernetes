import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionGroup, HubSectionConfig } from '../types/clusters';
import type { ClusterIconAsset, ClusterLens } from '../types/clusterExplorer';

const store = vi.hoisted(() => ({
  groups: [] as ConnectionGroup[],
  write: vi.fn(),
  values: {} as Record<string, unknown>,
  writes: vi.fn(),
}));
vi.mock('@omniviewdev/runtime', () => ({
  usePluginData: (_plugin: string, key: string, fallback: unknown) => ({
    data: key === 'cluster_groups' ? store.groups : (store.values[key] ?? fallback),
    isLoading: false,
    update: async (update: unknown) => {
      const current = key === 'cluster_groups' ? store.groups : (store.values[key] ?? fallback);
      const value = typeof update === 'function' ? update(current) : update;
      if (key === 'cluster_groups') {
        await store.write(value);
        store.groups = value;
      } else {
        await store.writes(key, value);
        store.values[key] = value;
      }
    },
  }),
}));
import { useClusterPreferences } from './useClusterPreferences';

describe('folder metadata migration persistence', () => {
  beforeEach(() => {
    store.groups = [
      {
        id: 'owned',
        name: 'Old',
        connectionIds: [],
        ruleSet: {
          logic: 'and',
          rules: [{ id: 'rule', field: 'data:k8s_version', operator: 'equals', value: 'v1.34' }],
        },
      },
    ];
    store.write.mockReset();
    store.values = {};
    store.writes.mockReset();
  });
  it('has no pending old migration that can overwrite a subsequent explicit edit', async () => {
    const { result, rerender } = renderHook(() => useClusterPreferences('kubernetes'));
    expect(store.write).not.toHaveBeenCalled();
    expect(result.current.customGroups[0].ruleSet!.rules[0].field).toBe(
      'metadata:kubernetes.server_version',
    );
    rerender();
    expect(store.write).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.updateGroup('owned', { name: 'New' });
    });
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(store.write.mock.calls[0][0][0]).toMatchObject({
      name: 'New',
      ruleSet: { rules: [{ field: 'metadata:kubernetes.server_version' }] },
    });
    rerender();
    expect(store.write).toHaveBeenCalledTimes(1);
  });
  it('propagates persistent write failure without an automatic retry or render loop', async () => {
    const failure = new Error('persistence unavailable');
    store.write.mockRejectedValue(failure);
    const { result, rerender } = renderHook(() => useClusterPreferences('kubernetes'));
    await act(async () => {
      await expect(result.current.updateGroup('owned', { name: 'New' })).rejects.toThrow(
        'persistence unavailable',
      );
    });
    for (let index = 0; index < 5; index++) rerender();
    expect(store.write).toHaveBeenCalledTimes(1);
  });
});

describe('saved organization', () => {
  beforeEach(() => {
    store.groups = [
      {
        id: 'folder',
        name: 'Folder',
        iconAssetId: 'asset',
        connectionIds: ['manual'],
        ruleSet: {
          logic: 'or',
          rules: [{ id: 'r', field: 'tag', operator: 'equals', value: 'prod' }],
        },
      },
    ];
    store.values = {};
    store.write.mockReset();
    store.writes.mockReset();
  });
  it('records repeated opens from one snapshot without losing counts and caps history', async () => {
    store.values.cluster_recent = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `old-${index}`,
        { lastAccessed: index, accessCount: 1 },
      ]),
    );
    const { result } = renderHook(() => useClusterPreferences('kubernetes'));
    await act(async () => {
      await result.current.recordAccess('opened');
      await result.current.recordAccess('opened');
    });
    const recent = store.values.cluster_recent as Record<string, { accessCount: number }>;
    expect(recent.opened.accessCount).toBe(2);
    expect(Object.keys(recent)).toHaveLength(100);
    expect(recent['old-0']).toBeUndefined();
  });
  it('applies section updaters to stored state newer than the rendered snapshot', async () => {
    store.values.hub_sections = [
      { type: 'group:a', collapsed: false },
      { type: 'group:b', collapsed: false },
    ];
    const { result } = renderHook(() => useClusterPreferences('kubernetes'));
    // Another view publishes a collapse change after this hook rendered.
    store.values.hub_sections = [
      { type: 'connected', collapsed: true },
      { type: 'group:a', collapsed: true },
      { type: 'group:b', collapsed: false },
    ];
    await act(async () => {
      await result.current.setHubSections((current) => [
        current[0], current[2], current[1],
      ]);
    });
    const sections = store.values.hub_sections as HubSectionConfig[];
    expect(sections).toEqual([
      { type: 'connected', collapsed: true },
      { type: 'group:b', collapsed: false },
      { type: 'group:a', collapsed: true },
    ]);
  });
  it('removes an in-use asset only after preserving every folder image and rule', async () => {
    const asset: ClusterIconAsset = {
      id: 'asset',
      name: 'Logo',
      dataUrl: 'data:image/png;base64,YQ==',
      createdAt: 1,
    };
    store.values.cluster_icon_assets = [asset];
    const { result } = renderHook(() => useClusterPreferences('kubernetes'));
    await act(async () => {
      await result.current.removeIconAsset('asset');
    });
    expect(store.write.mock.calls[0][0][0]).toMatchObject({
      customImage: asset.dataUrl,
      iconAssetId: undefined,
      connectionIds: ['manual'],
      ruleSet: store.groups[0].ruleSet,
    });
    expect(store.write.mock.invocationCallOrder[0]).toBeLessThan(
      store.writes.mock.invocationCallOrder[0],
    );
    expect(store.values.cluster_icon_assets).toEqual([]);
  });
  it('keeps the library when fallback persistence fails', async () => {
    store.values.cluster_icon_assets = [
      { id: 'asset', name: 'Logo', dataUrl: 'data:image/png;base64,YQ==', createdAt: 1 },
    ];
    store.write.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useClusterPreferences('kubernetes'));
    await expect(result.current.removeIconAsset('asset')).rejects.toThrow('offline');
    expect(store.writes).not.toHaveBeenCalled();
  });
  it('round-trips all lens state and preserves omitted lenses during reorder', async () => {
    const lens: ClusterLens = {
      id: 'a',
      name: 'Production',
      query: 'tag:prod',
      filters: { providers: ['aws'] },
      groupBy: 'provider',
      sortBy: 'recency',
      sortDirection: 'desc',
      viewMode: 'debug',
      scope: 'connected',
    };
    const { result, rerender } = renderHook(() => useClusterPreferences('kubernetes'));
    await act(async () => {
      await result.current.saveLens(lens);
    });
    rerender();
    expect(result.current.savedLenses).toEqual([lens]);
    await act(async () => {
      await result.current.saveLens({ ...lens, id: 'b', name: 'Second' });
    });
    rerender();
    await act(async () => {
      await result.current.reorderLenses(['b', 'b', 'unknown']);
    });
    rerender();
    expect(result.current.savedLenses.map((entry) => entry.id)).toEqual(['b', 'a']);
    await act(async () => {
      await result.current.removeLens('a');
    });
    rerender();
    expect(result.current.savedLenses.map((entry) => entry.id)).toEqual(['b']);
  });
  it('persists collapse for a new folder absent from default section configs without duplicates', async () => {
    const { result, rerender } = renderHook(() => useClusterPreferences('kubernetes'));
    await act(async () => {
      await result.current.updateHubSectionCollapsed('group:new-folder', true);
    });
    rerender();
    expect(result.current.hubSections).toContainEqual({ type: 'group:new-folder', collapsed: true });
    await act(async () => {
      await result.current.updateHubSectionCollapsed('group:new-folder', false);
    });
    rerender();
    expect(result.current.hubSections.filter((section) => section.type === 'group:new-folder'))
      .toEqual([{ type: 'group:new-folder', collapsed: false }]);
  });
  it('moves only manual membership while preserving source rules', async () => {
    store.groups.push({ id: 'target', name: 'Target', connectionIds: [] });
    const { result } = renderHook(() => useClusterPreferences('kubernetes'));
    await act(async () => {
      await result.current.moveToGroup('target', 'manual', 'folder');
    });
    expect(store.write.mock.calls[0][0]).toEqual([
      { ...store.groups[0], connectionIds: [] },
      { ...store.groups[1], connectionIds: ['manual'] },
    ]);
  });
});
