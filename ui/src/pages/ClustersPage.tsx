import { Button, Skeleton, Stack, Text } from '@omniviewdev/base-ui';
import { usePluginContext, useConnections, useConnection, useNotifications } from '@omniviewdev/runtime';
import React from 'react';

import { useStoredState } from '@/hooks/useStoredState';

import ClusterHub from '../components/connections/ClusterHub';
import ClustersToolbar from '../components/connections/ClustersToolbar';
import ConnectionTable from '../components/connections/ConnectionTable';
import DeleteConfirmationModal from '../components/connections/DeleteConfirmationModal';
import EmptyState from '../components/connections/EmptyState';
import FilterChips from '../components/connections/FilterChips';
import FolderDialog, { type FolderDialogValues } from '../components/connections/FolderDialog';
import { useClusterPreferences } from '../hooks/useClusterPreferences';
import { useConnectionGrouping } from '../hooks/useConnectionGrouping';
import { ClusterOrganization } from '../components/connections/ClusterOrganization';
import ExplorerSidebar from '../components/connections/ExplorerSidebar';
import { computeEffectiveMembers } from '../utils/folderRules';
import styles from './ClustersPage.module.css';
import { useClusterAction } from '../hooks/useClusterAction';
import type { ClusterScope } from '../types/clusterExplorer';
import type {
  ConnectionGroup,
  GroupByMode,
  SortByField,
  SortDirection,
  ViewMode,
  FilterState,
} from '../types/clusters';


const DEFAULT_VISIBLE_COLUMNS = ['cluster', 'kubeconfig', 'user'];

const loadingSkeletonStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 8,
};

export default function ClustersPage(): React.ReactElement {
  const { meta } = usePluginContext();
  const { connections } = useConnections({ plugin: meta.id });
   
  const { notify } = useNotifications();

  const [organize, setOrganize] = React.useState(false);
  const [scope, setScope] = React.useState<ClusterScope>('all');
  const searchRef = React.useRef<HTMLInputElement>(null);
  const openAction = React.useRef<(() => void) | undefined>(undefined);
  const resultsRef = React.useRef<HTMLDivElement>(null);
  const [visualOrder, setVisualOrder] = React.useState<string[]>();
  const [selectedId, setSelectedId] = React.useState<string>();
  const [viewMode, setViewMode] = useStoredState<ViewMode>('kubernetes-clusters-view', 'grid');
  const [groupBy, setGroupBy] = useStoredState<GroupByMode>('kubernetes-clusters-groupby', 'none');
  const [sortBy, setSortBy] = useStoredState<SortByField>('kubernetes-clusters-sortby', 'name');
  const [sortDirection, setSortDirection] = useStoredState<SortDirection>(
    'kubernetes-clusters-sortdir',
    'asc',
  );
  const [visibleColumns, setVisibleColumns] = useStoredState<string[]>(
    'kubernetes-clusters-columns',
    DEFAULT_VISIBLE_COLUMNS,
  );

  // Ephemeral UI state
  const [search, setSearch] = React.useState('');
  const [filters, setFilters] = React.useState<FilterState>({});
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: string; name: string } | null>(null);
  const [folderDialog, setFolderDialog] = React.useState<{
    mode: 'create' | 'edit';
    groupId?: string;
    initial?: Partial<FolderDialogValues>;
    pendingConnectionId?: string;
  } | null>(null);

  // Plugin data store preferences
  const preferences = useClusterPreferences(meta.id);
  const hubGrouped = useConnectionGrouping({
    connections: connections.data ?? [],
    favorites: preferences.favorites,
    connectionOverrides: preferences.connectionOverrides,
    customGroups: preferences.customGroups,
    recentConnections: preferences.recentConnections,
    search: '',
    groupBy: 'none',
    sortBy: 'name',
    sortDirection: 'asc',
    filters: {},
  });
  const hubEnriched = React.useMemo(
    () => hubGrouped.groups.flatMap((group) => group.connections),
    [hubGrouped.groups],
  );
  const hubById = React.useMemo(
    () => new Map(hubEnriched.map((entry) => [entry.connection.id, entry])),
    [hubEnriched],
  );
  const folderMembers = React.useMemo(() => {
    if (!scope.startsWith('group:')) return undefined;
    const folder = preferences.customGroups.find((group) => group.id === scope.slice(6));
    return folder
      ? computeEffectiveMembers(folder.connectionIds, folder.ruleSet, hubEnriched)
      : new Set<string>();
  }, [scope, preferences.customGroups, hubEnriched]);
  const scopedConnections = React.useMemo(
    () =>
      (connections.data ?? []).filter((connection) => {
        if (folderMembers) return folderMembers.has(connection.id);
        const enriched = hubById.get(connection.id);
        if (scope === 'favorites') return !!enriched?.isFavorite;
        if (scope === 'recent') return !!enriched?.lastAccessed;
        if (scope === 'connected') return !!enriched?.isConnected;
        return true;
      }),
    [connections.data, scope, hubById, folderMembers],
  );

  // Grouped/filtered/sorted result
  const grouped = useConnectionGrouping({
    connections: scopedConnections,
    favorites: preferences.favorites,
    connectionOverrides: preferences.connectionOverrides,
    customGroups: preferences.customGroups,
    recentConnections: preferences.recentConnections,
    search,
    groupBy: viewMode === 'debug' ? 'none' : groupBy,
    sortBy,
    sortDirection,
    filters,
  });

  // All label keys across connections
  const allLabelKeys = React.useMemo(() => {
    const keys = new Set<string>();
    for (const conn of connections.data ?? []) {
      if (conn.labels) {
        for (const key of Object.keys(conn.labels)) {
          keys.add(key);
        }
      }
    }
    return [...keys].sort();
  }, [connections.data]);

  const handleToggleColumn = React.useCallback(
    (column: string) => {
      setVisibleColumns((prev) => {
        if (prev.includes(column)) {
          return prev.filter((c) => c !== column);
        }
        return [...prev, column];
      });
    },
    [setVisibleColumns],
  );

  const handleToggleCollapse = React.useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const handleToggleProvider = React.useCallback((provider: string) => {
    setFilters((prev) => {
      const current = prev.providers ?? [];
      const next = current.includes(provider)
        ? current.filter((p) => p !== provider)
        : [...current, provider];
      return { ...prev, providers: next.length > 0 ? next : undefined };
    });
  }, []);

  const handleToggleStatus = React.useCallback((status: 'connected' | 'disconnected') => {
    setFilters((prev) => {
      const current = prev.status ?? [];
      const next = current.includes(status)
        ? current.filter((s) => s !== status)
        : [...current, status];
      return { ...prev, status: next.length > 0 ? next : undefined };
    });
  }, []);

  const handleToggleTag = React.useCallback((tag: string) => {
    setFilters((prev) => {
      const current = prev.tags ?? [];
      const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
      return { ...prev, tags: next.length > 0 ? next : undefined };
    });
  }, []);

  const handleToggleLabelFilter = React.useCallback((key: string, value: string) => {
    setFilters((prev) => {
      const currentLabels = prev.labels ?? {};
      const currentValues = currentLabels[key] ?? [];
      const nextValues = currentValues.includes(value)
        ? currentValues.filter((v) => v !== value)
        : [...currentValues, value];
      const nextLabels = { ...currentLabels };
      if (nextValues.length > 0) {
        nextLabels[key] = nextValues;
      } else {
        delete nextLabels[key];
      }
      return { ...prev, labels: Object.keys(nextLabels).length > 0 ? nextLabels : undefined };
    });
  }, []);

  const handleClearFilters = React.useCallback(() => {
    setFilters({});
    setSearch('');
  }, []);

  const handleCreateFolder = React.useCallback((connectionId?: string) => {
    setFolderDialog({ mode: 'create', pendingConnectionId: connectionId });
  }, []);

  const handleEditFolder = React.useCallback(
    (groupId: string) => {
      const group = preferences.customGroups.find((g) => g.id === groupId);
      if (!group) return;
      setFolderDialog({
        mode: 'edit',
        groupId,
        initial: {
          name: group.name,
          color: group.color,
          icon: group.icon,
          customImage: group.customImage,
          iconAssetId: group.iconAssetId,
          ruleSet: group.ruleSet,
        },
      });
    },
    [preferences.customGroups],
  );

  const handleFolderSubmit = React.useCallback(
    async (values: FolderDialogValues) => {
      if (folderDialog?.mode === 'edit' && folderDialog.groupId) {
        await preferences.updateGroup(folderDialog.groupId, { ...values, ruleSet: values.ruleSet });
        void notify({ severity: 'success', title: `Folder '${values.name}' updated` });
      } else {
        const newGroup: ConnectionGroup = {
          id: crypto.randomUUID(),
          name: values.name,
          color: values.color,
          icon: values.icon,
          customImage: values.customImage,
          iconAssetId: values.iconAssetId,
          connectionIds: folderDialog?.pendingConnectionId
            ? [folderDialog.pendingConnectionId]
            : [],
          ruleSet: values.ruleSet,
        };
        await preferences.addGroup(newGroup);
        void notify({ severity: 'success', title: `Folder '${values.name}' created` });
      }
      setFolderDialog(null);
    },
    [folderDialog, preferences, notify],
  );

  const handleFolderDelete = React.useCallback(async () => {
    if (folderDialog?.groupId) {
      await preferences.removeGroup(folderDialog.groupId);
      void notify({ severity: 'success', title: 'Folder deleted' });
    }
    setFolderDialog(null);
  }, [folderDialog, preferences, notify]);

  const handleDeleteRequest = React.useCallback((id: string, name: string) => {
    setDeleteTarget({ id, name });
  }, []);
  const availableResults = grouped.groups.flatMap((group) =>
    viewMode !== 'debug' && collapsedGroups.has(group.key) ? [] : group.connections,
  );
  const byId = new Map(availableResults.map((entry) => [entry.connection.id, entry]));
  const orderedResults = [
    ...new Set(visualOrder ?? availableResults.map((entry) => entry.connection.id)),
  ].flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
  const activeId = orderedResults.some((entry) => entry.connection.id === selectedId)
    ? selectedId
    : orderedResults[0]?.connection.id;
  React.useEffect(() => {
    if (viewMode !== 'grid') return;
    const selected = Array.from(
      resultsRef.current?.querySelectorAll<HTMLElement>('[data-cluster-open]') ?? [],
    ).find((element) => element.dataset.clusterOpen === activeId);
    selected?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId, viewMode]);
  React.useEffect(() => {
    searchRef.current?.focus();
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !target.closest('input,textarea,[contenteditable="true"]')
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);
  const openSelected = () => {
    openAction.current?.();
  };
  const navigateResults: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const index = orderedResults.findIndex((entry) => entry.connection.id === activeId);
    const next = Math.max(
      0,
      Math.min(orderedResults.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
    );
    setSelectedId(orderedResults[next]?.connection.id);
  };

  const isInitialLoading = connections.isLoading && !connections.data;
  const noConnections = !isInitialLoading && (connections.data?.length ?? 0) === 0;
  const noResults = !noConnections && grouped.filteredCount === 0;

  return (
    <ClusterOrganization
      onAssignToGroup={(groupId, connectionId) => preferences.assignToGroup(groupId, connectionId)}
    >
      <div className={styles.explorer}>
        <ExplorerSidebar
          scope={scope}
          onScopeChange={(value) => {
            setScope(value);
            setOrganize(false);
          }}
          connections={hubEnriched}
          preferences={preferences}
          onCreateFolder={() => handleCreateFolder()}
          onEditFolder={handleEditFolder}
          onOrganize={() => setOrganize((value) => !value)}
          organizing={organize}
          currentLens={{ query: search, filters, groupBy, sortBy, sortDirection, viewMode, scope }}
          onApplyLens={(lens) => {
            setSearch(lens.query);
            setFilters(lens.filters);
            setGroupBy(lens.groupBy);
            setSortBy(lens.sortBy);
            setSortDirection(lens.sortDirection);
            setViewMode(lens.viewMode);
            const lensScope = lens.scope ?? 'all';
            setScope(
              lensScope.startsWith('group:') &&
                !preferences.customGroups.some((group) => group.id === lensScope.slice(6))
                ? 'all'
                : lensScope,
            );
            setOrganize(false);
          }}
          attributes={hubGrouped.availableAttributes}
          onBrowse={(key, value) => {
            setScope('all');
            setFilters((previous) => ({
              ...previous,
              labels: { ...previous.labels, [key]: [value] },
            }));
            setOrganize(false);
          }}
        />
        <main className={styles.main}>
          {!organize && activeId && (
            <SelectedClusterAction
              key={activeId}
              connectionId={activeId}
              isConnected={!!byId.get(activeId)?.isConnected}
              actionRef={openAction}
            />
          )}
          <ClustersToolbar
            search={search}
            onSearchChange={(value) => {
              setSearch(value);
              setSelectedId(undefined);
            }}
            searchFields={grouped.searchFields}
            searchDiagnostics={grouped.searchDiagnostics}
            searchRef={searchRef}
            onSearchKeyDown={navigateResults}
            onSubmit={openSelected}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            sortBy={sortBy}
            onSortByChange={setSortBy}
            sortDirection={sortDirection}
            onSortDirectionChange={setSortDirection}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            totalCount={grouped.totalCount}
            filteredCount={grouped.filteredCount}
            hasCustomGroups={preferences.customGroups.length > 0}
            availableAttributes={grouped.availableAttributes}
            availableTags={grouped.availableTags}
          />
          <FilterChips
            filters={filters}
            availableProviders={grouped.availableProviders}
            availableAttributes={grouped.availableAttributes}
            availableTags={grouped.availableTags}
            onToggleProvider={handleToggleProvider}
            onToggleStatus={handleToggleStatus}
            onToggleTag={handleToggleTag}
            onToggleLabelFilter={handleToggleLabelFilter}
            onClearAll={handleClearFilters}
          />
          {organize && (
            <Stack direction="row" align="center" justify="between">
              <Text weight="semibold">Organize folders and sections</Text>
              <Button size="sm" onClick={() => setOrganize(false)}>
                Done
              </Button>
            </Stack>
          )}
          {isInitialLoading ? (
            <ConnectionsLoadingSkeleton />
          ) : noConnections ? (
            <EmptyState variant="no-connections" />
          ) : organize ? (
            <ClusterHub
              enrichedConnections={hubEnriched}
              availableAttributes={hubGrouped.availableAttributes}
              customGroups={preferences.customGroups}
              hubSections={preferences.hubSections}
              onReorderSections={(sections) => {
                void preferences.setHubSections(sections);
              }}
              onToggleCollapse={(sectionType, collapsed) => {
                void preferences.updateHubSectionCollapsed(sectionType, collapsed);
              }}
              onToggleFavorite={(id) => {
                void preferences.toggleFavorite(id);
              }}
              onCreateFolder={handleCreateFolder}
              onEditFolder={handleEditFolder}
            />
          ) : noResults ? (
            <EmptyState
              variant="no-results"
              onClearFilters={() => {
                handleClearFilters();
                setScope('all');
              }}
            />
          ) : (
            <div ref={resultsRef} className={styles.results}>
              <ConnectionTable
                grouped={grouped}
                groupBy={groupBy}
                viewMode={viewMode}
                selectedId={activeId}
                debug={viewMode === 'debug'}
                onVisualOrderChange={setVisualOrder}
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSortChange={(field, direction) => {
                  setSortBy(field);
                  setSortDirection(direction);
                }}
                customGroups={preferences.customGroups}
                collapsedGroups={collapsedGroups}
                visibleColumns={visibleColumns}
                allLabelKeys={allLabelKeys}
                onToggleColumn={handleToggleColumn}
                onToggleCollapse={handleToggleCollapse}
                onToggleFavorite={(id) => {
                  void preferences.toggleFavorite(id);
                }}
                onAssignToGroup={(groupId, id) => {
                  void preferences.assignToGroup(groupId, id);
                }}
                onRemoveFromGroup={(groupId, id) => {
                  void preferences.removeFromGroup(groupId, id);
                }}
                onCreateFolder={handleCreateFolder}
                onDeleteRequest={handleDeleteRequest}
              />
            </div>
          )}
        </main>

        {deleteTarget && (
          <DeleteConnectionHandler
            pluginID={meta.id}
            connectionId={deleteTarget.id}
            connectionName={deleteTarget.name}
            onClose={() => setDeleteTarget(null)}
          />
        )}

        {folderDialog && (
          <FolderDialog
            open
            pluginID={meta.id}
            mode={folderDialog.mode}
            initial={folderDialog.initial}
            existingNames={preferences.customGroups.map((g) => g.name)}
            enrichedConnections={hubEnriched}
            onSubmit={(values) => {
              void handleFolderSubmit(values);
            }}
            onDelete={
              folderDialog.mode === 'edit'
                ? () => {
                    void handleFolderDelete();
                  }
                : undefined
            }
            onClose={() => setFolderDialog(null)}
          />
        )}
      </div>
    </ClusterOrganization>
  );
}

function SelectedClusterAction({
  connectionId,
  isConnected,
  actionRef,
}: {
  connectionId: string;
  isConnected: boolean;
  actionRef: React.MutableRefObject<(() => void) | undefined>;
}) {
  const { handleClick } = useClusterAction(connectionId, isConnected);
  React.useEffect(() => {
    const action = () => {
      void handleClick();
    };
    actionRef.current = action;
    return () => {
      if (actionRef.current === action) actionRef.current = undefined;
    };
  }, [actionRef, handleClick]);
  return null;
}

function ConnectionsLoadingSkeleton() {
  return (
    <div style={loadingSkeletonStyle}>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} variant="rounded" height={48} />
      ))}
    </div>
  );
}

/**
 * Separate component to handle delete confirmation + mutation,
 * since useConnection requires the connectionID at hook level.
 */
function DeleteConnectionHandler({
  pluginID,
  connectionId,
  connectionName,
  onClose,
}: {
  pluginID: string;
  connectionId: string;
  connectionName: string;
  onClose: () => void;
}) {
  const { removeConnection } = useConnection({ pluginID, connectionID: connectionId });

  const handleConfirm = () => {
    removeConnection()
      .then(() => onClose())
      .catch(() => onClose());
  };

  return (
    <DeleteConfirmationModal
      open
      connectionName={connectionName}
      onConfirm={handleConfirm}
      onCancel={onClose}
    />
  );
}
