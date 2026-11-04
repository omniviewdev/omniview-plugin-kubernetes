import { usePluginData } from '@omniviewdev/runtime';
import { useCallback, useMemo } from 'react';
import { migrateFolderMetadataRules } from '../utils/migrateFolderMetadataRules';
import type { ClusterIconAsset, ClusterLens } from '../types/clusterExplorer';

import type {
  ConnectionOverride,
  ConnectionGroup,
  RecentEntry,
  HubSectionConfig,
} from '../types/clusters';

const DEFAULT_FAVORITES: string[] = [];
const DEFAULT_GROUPS: ConnectionGroup[] = [];
const DEFAULT_OVERRIDES: Record<string, ConnectionOverride> = {};
const DEFAULT_RECENT: Record<string, RecentEntry> = {};
const DEFAULT_HUB_SECTIONS: HubSectionConfig[] = [
  { type: 'connected', collapsed: false },
  { type: 'recent', collapsed: false },
  { type: 'favorites', collapsed: false },
  { type: 'browse', collapsed: false },
];

const MAX_RECENT_ENTRIES = 100;
const DEFAULT_LENSES: ClusterLens[] = [];
const DEFAULT_ICON_ASSETS: ClusterIconAsset[] = [];

export interface ClusterPreferencesState {
  favorites: string[];
  customGroups: ConnectionGroup[];
  connectionOverrides: Record<string, ConnectionOverride>;
  recentConnections: Record<string, RecentEntry>;
  hubSections: HubSectionConfig[];
  savedLenses: ClusterLens[];
  iconAssets: ClusterIconAsset[];
  availableTags: string[];
  isLoading: boolean;
  toggleFavorite(id: string): Promise<void>;
  addGroup(group: ConnectionGroup): Promise<void>;
  removeGroup(id: string): Promise<void>;
  assignToGroup(groupId: string, connectionId: string): Promise<void>;
  removeFromGroup(groupId: string, connectionId: string): Promise<void>;
  moveToGroup(targetId: string, connectionId: string, sourceId?: string): Promise<void>;
  updateGroup(
    id: string,
    updates: Partial<Omit<ConnectionGroup, 'id' | 'connectionIds'>>,
  ): Promise<void>;
  updateOverride(id: string, override: ConnectionOverride): Promise<void>;
  removeOverride(id: string): Promise<void>;
  recordAccess(id: string): Promise<void>;
  setHubSections(sections: HubSectionConfig[]): Promise<void>;
  updateHubSectionCollapsed(type: string, collapsed: boolean): Promise<void>;
  saveLens(lens: ClusterLens): Promise<ClusterLens>;
  removeLens(id: string): Promise<void>;
  reorderLenses(ids: string[]): Promise<void>;
  addIconAsset(asset: ClusterIconAsset): Promise<ClusterIconAsset>;
  removeIconAsset(id: string): Promise<void>;
}
/**
 * Manages cluster preferences backed by the Plugin Data Store.
 * Wraps usePluginData calls for favorites, custom groups, per-connection overrides, and recency tracking.
 */
export function useClusterPreferences(pluginID: string): ClusterPreferencesState {
  const {
    data: savedLenses,
    update: setSavedLenses,
    isLoading: lensesLoading,
  } = usePluginData<ClusterLens[]>(pluginID, 'cluster_saved_lenses', DEFAULT_LENSES);
  const {
    data: iconAssets,
    update: setIconAssets,
    isLoading: assetsLoading,
  } = usePluginData<ClusterIconAsset[]>(pluginID, 'cluster_icon_assets', DEFAULT_ICON_ASSETS);
  const {
    data: favorites,
    update: setFavorites,
    isLoading: favoritesLoading,
  } = usePluginData<string[]>(pluginID, 'cluster_favorites', DEFAULT_FAVORITES);

  const {
    data: storedCustomGroups,
    update: setCustomGroupsRaw,
    isLoading: groupsLoading,
  } = usePluginData<ConnectionGroup[]>(pluginID, 'cluster_groups', DEFAULT_GROUPS);

  const customGroups = useMemo(
    () => migrateFolderMetadataRules(storedCustomGroups ?? DEFAULT_GROUPS),
    [storedCustomGroups],
  );
  // Persist migration only with an explicit folder edit. A background migration
  // must never race a newer edit or retry indefinitely after persistence fails.
  const setCustomGroups = useCallback(
    async (update: ConnectionGroup[] | ((current: ConnectionGroup[]) => ConnectionGroup[])) => {
      await setCustomGroupsRaw((stored) => {
        const current = migrateFolderMetadataRules(stored);
        return migrateFolderMetadataRules(typeof update === 'function' ? update(current) : update);
      });
    },
    [setCustomGroupsRaw],
  );

  const {
    data: connectionOverrides,
    update: setConnectionOverrides,
    isLoading: overridesLoading,
  } = usePluginData<Record<string, ConnectionOverride>>(
    pluginID,
    'cluster_overrides',
    DEFAULT_OVERRIDES,
  );

  const {
    data: recentConnections,
    update: setRecentConnections,
    isLoading: recentLoading,
  } = usePluginData<Record<string, RecentEntry>>(pluginID, 'cluster_recent', DEFAULT_RECENT);

  const {
    data: hubSections,
    update: setHubSectionsRaw,
    isLoading: hubSectionsLoading,
  } = usePluginData<HubSectionConfig[]>(pluginID, 'hub_sections', DEFAULT_HUB_SECTIONS);

  const setHubSections = useCallback(
    async (sections: HubSectionConfig[]) => {
      await setHubSectionsRaw(sections);
    },
    [setHubSectionsRaw],
  );

  const updateHubSectionCollapsed = useCallback(
    async (sectionType: string, collapsed: boolean) => {
      const type: HubSectionConfig['type'] | undefined =
        sectionType === 'connected' || sectionType === 'recent' ||
        sectionType === 'favorites' || sectionType === 'browse'
          ? sectionType
          : sectionType.startsWith('group:') ? `group:${sectionType.slice(6)}` : undefined;
      if (!type) return;
      await setHubSectionsRaw((current) =>
        current.some((section) => section.type === sectionType)
          ? current.map((section) =>
              section.type === sectionType ? { ...section, collapsed } : section,
            )
          : [...current, { type, collapsed }],
      );
    },
    [setHubSectionsRaw],
  );

  const toggleFavorite = useCallback(
    async (connectionId: string) => {
      await setFavorites((current) =>
        current.includes(connectionId)
          ? current.filter((id) => id !== connectionId)
          : [...current, connectionId],
      );
    },
    [setFavorites],
  );

  const addGroup = useCallback(
    async (group: ConnectionGroup) => {
      await setCustomGroups((current) => [...current, group]);
    },
    [setCustomGroups],
  );
  const removeGroup = useCallback(
    async (groupId: string) => {
      await setCustomGroups((current) => current.filter((group) => group.id !== groupId));
    },
    [setCustomGroups],
  );
  const assignToGroup = useCallback(
    async (groupId: string, connectionId: string) => {
      await setCustomGroups((current) =>
        current.map((group) =>
          group.id !== groupId || group.connectionIds.includes(connectionId)
            ? group
            : { ...group, connectionIds: [...group.connectionIds, connectionId] },
        ),
      );
    },
    [setCustomGroups],
  );
  const removeFromGroup = useCallback(
    async (groupId: string, connectionId: string) => {
      await setCustomGroups((current) =>
        current.map((group) =>
          group.id !== groupId
            ? group
            : { ...group, connectionIds: group.connectionIds.filter((id) => id !== connectionId) },
        ),
      );
    },
    [setCustomGroups],
  );
  const updateGroup = useCallback(
    async (groupId: string, updates: Partial<Omit<ConnectionGroup, 'id' | 'connectionIds'>>) => {
      await setCustomGroups((current) =>
        current.map((group) => (group.id === groupId ? { ...group, ...updates } : group)),
      );
    },
    [setCustomGroups],
  );
  const updateOverride = useCallback(
    async (connectionId: string, override: ConnectionOverride) => {
      await setConnectionOverrides((current) => ({ ...current, [connectionId]: override }));
    },
    [setConnectionOverrides],
  );
  const removeOverride = useCallback(
    async (connectionId: string) => {
      await setConnectionOverrides((current) => {
        const next = { ...current };
        delete next[connectionId];
        return next;
      });
    },
    [setConnectionOverrides],
  );
  const recordAccess = useCallback(
    async (connectionId: string) => {
      await setRecentConnections((current) => {
        const next = {
          ...current,
          [connectionId]: {
            lastAccessed: Date.now(),
            accessCount: (current[connectionId]?.accessCount ?? 0) + 1,
          },
        };
        const keys = Object.keys(next).sort((a, b) => next[b].lastAccessed - next[a].lastAccessed);
        for (const key of keys.slice(MAX_RECENT_ENTRIES)) delete next[key];
        return next;
      });
    },
    [setRecentConnections],
  );

  const saveLens = useCallback(
    async (lens: ClusterLens) => {
      const name = lens.name.trim();
      if (!name) throw new Error('Lens name is required');
      const entry = { ...lens, id: lens.id || crypto.randomUUID(), name };
      await setSavedLenses((current) =>
        current.some((item) => item.id === entry.id)
          ? current.map((item) => (item.id === entry.id ? entry : item))
          : [...current, entry],
      );
      return entry;
    },
    [setSavedLenses],
  );
  const removeLens = useCallback(
    async (id: string) => {
      await setSavedLenses((current) => current.filter((lens) => lens.id !== id));
    },
    [setSavedLenses],
  );
  const reorderLenses = useCallback(
    async (ids: string[]) => {
      const order = [...new Set(ids)];
      await setSavedLenses((current) => [
        ...order.flatMap((id) => current.filter((lens) => lens.id === id)),
        ...current.filter((lens) => !order.includes(lens.id)),
      ]);
    },
    [setSavedLenses],
  );
  const addIconAsset = useCallback(
    async (asset: ClusterIconAsset) => {
      if (
        !asset.name.trim() ||
        !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(asset.dataUrl) ||
        asset.dataUrl.length > 140_000
      )
        throw new Error('Invalid raster icon asset');
      let entry = { ...asset, id: asset.id || crypto.randomUUID(), name: asset.name.trim() };
      await setIconAssets((current) => {
        const duplicate = current.find((item) => item.dataUrl === asset.dataUrl);
        if (duplicate) {
          entry = duplicate;
          return current;
        }
        if (current.some((item) => item.id === entry.id))
          throw new Error('Icon asset ID already exists');
        return [...current, entry];
      });
      return entry;
    },
    [setIconAssets],
  );
  // Persist fallback first: failure cannot leave a folder pointing at a deleted asset.
  const removeIconAsset = useCallback(
    async (id: string) => {
      const asset = (iconAssets ?? []).find((entry) => entry.id === id);
      if (!asset) return;
      await setCustomGroups((current) =>
        current.map((group) =>
          group.iconAssetId === id
            ? { ...group, iconAssetId: undefined, customImage: asset.dataUrl }
            : group,
        ),
      );
      await setIconAssets((current) => current.filter((entry) => entry.id !== id));
    },
    [iconAssets, setCustomGroups, setIconAssets],
  );
  const moveToGroup = useCallback(
    async (targetId: string, connectionId: string, sourceId?: string) => {
      await setCustomGroups((current) => {
        if (!current.some((group) => group.id === targetId)) return current;
        return current.map((group) => {
          if (group.id === targetId)
            return {
              ...group,
              connectionIds: [...new Set([...group.connectionIds, connectionId])],
            };
          if (group.id === sourceId)
            return {
              ...group,
              connectionIds: group.connectionIds.filter((id) => id !== connectionId),
            };
          return group;
        });
      });
    },
    [setCustomGroups],
  );
  // Collect all tags used across all connection overrides
  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    for (const override of Object.values(connectionOverrides ?? {})) {
      if (override.tags) {
        for (const tag of override.tags) {
          tags.add(tag);
        }
      }
    }
    return [...tags].sort();
  }, [connectionOverrides]);

  return {
    savedLenses: savedLenses ?? DEFAULT_LENSES,
    iconAssets: iconAssets ?? DEFAULT_ICON_ASSETS,
    saveLens,
    removeLens,
    reorderLenses,
    addIconAsset,
    removeIconAsset,
    moveToGroup,
    favorites: favorites ?? DEFAULT_FAVORITES,
    customGroups: customGroups ?? DEFAULT_GROUPS,
    connectionOverrides: connectionOverrides ?? DEFAULT_OVERRIDES,
    recentConnections: recentConnections ?? DEFAULT_RECENT,
    hubSections: hubSections ?? DEFAULT_HUB_SECTIONS,
    availableTags,
    isLoading:
      favoritesLoading ||
      groupsLoading ||
      overridesLoading ||
      recentLoading ||
      hubSectionsLoading ||
      lensesLoading ||
      assetsLoading,
    toggleFavorite,
    addGroup,
    removeGroup,
    assignToGroup,
    removeFromGroup,
    updateGroup,
    updateOverride,
    removeOverride,
    recordAccess,
    setHubSections,
    updateHubSectionCollapsed,
  };
}
