import { Button, DataTable, useDataTable, type DataTableColumnDef } from '@omniviewdev/base-ui';
import { useSnackbar } from '@omniviewdev/runtime';
import React from 'react';

import { useClusterAction } from '../../hooks/useClusterAction';
import type {
  GroupedConnectionsResult,
  GroupByMode,
  ViewMode,
  ConnectionGroup,
  EnrichedConnection,
  SortByField,
  SortDirection,
} from '../../types/clusters';
import { getClusterDisplayFacts, type ClusterDisplayFact } from '../../utils/clusterSearch';

import ConnectionCard from './ConnectionCard';
import ConnectionGroupComp from './ConnectionGroup';
import ConnectionTableItem from './ConnectionTableItem';

type Props = {
  grouped: GroupedConnectionsResult;
  groupBy: GroupByMode;
  viewMode: ViewMode;
  customGroups: ConnectionGroup[];
  collapsedGroups: Set<string>;
  visibleColumns: string[];
  allLabelKeys: string[];
  onToggleColumn: (column: string) => void;
  onToggleCollapse: (groupKey: string) => void;
  onToggleFavorite: (connectionId: string) => void;
  onAssignToGroup: (groupId: string, connectionId: string) => void;
  onRemoveFromGroup?: (groupId: string, connectionId: string) => void;
  onCreateFolder?: (connectionId: string) => void;
  onDeleteRequest: (connectionId: string, connectionName: string) => void;
  selectedId?: string;
  onVisualOrderChange?: (ids: string[]) => void;
  debug?: boolean;
  sortBy?: SortByField;
  sortDirection?: SortDirection;
  onSortChange?: (field: SortByField, direction: SortDirection) => void;
};

const features = { sorting: true, columnVisibility: true, columnResizing: true, pagination: false };
const factCell = (fact?: ClusterDisplayFact) =>
  fact ? (
    <span title={`${fact.provenance} · ${fact.key}`}>
      {fact.value}
      {fact.hint ? ' (configured hint)' : ''}
    </span>
  ) : (
    'Unknown'
  );

const GridCardWrapper = ({ enriched, ...props }: Props & { enriched: EnrichedConnection }) => {
  const id = enriched.connection.id;
  const { handleClick, handleConnect, handleDisconnect } = useClusterAction(
    id,
    enriched.isConnected,
  );
  const snackbar = useSnackbar();
  return (
    <ConnectionCard
      enriched={enriched}
      customGroups={props.customGroups}
      selected={props.selectedId === id}
      onClick={() => { void handleClick(); }}
      onConnect={() => { void handleConnect(); }}
      onDisconnect={() => { void handleDisconnect(); }}
      onToggleFavorite={() => props.onToggleFavorite(id)}
      onAssignToGroup={(groupId) => props.onAssignToGroup(groupId, id)}
      onRemoveFromGroup={
        props.onRemoveFromGroup ? (groupId) => props.onRemoveFromGroup?.(groupId, id) : undefined
      }
      onCreateFolder={props.onCreateFolder}
      onDelete={() => props.onDeleteRequest(id, enriched.displayName)}
      onCopyId={() => {
        void navigator.clipboard.writeText(id).then(
          () => {
            snackbar.showSnackbar({ status: 'success', message: 'Connection ID copied' });
          },
          (error: unknown) => {
            snackbar.showSnackbar({
              status: 'error',
              message: error instanceof Error ? error.message : 'Failed to copy connection ID',
            });
          },
        );
      }}
    />
  );
};

function TableSection({ connections, ...props }: Props & { connections: EnrichedConnection[] }) {
  const [compact, setCompact] = React.useState(true);
  const [coreVisibility, setCoreVisibility] = React.useState<Record<string, boolean>>({});
  const [localSorting, setLocalSorting] = React.useState<{ id: string; desc: boolean }[]>([]);
  const sorting = props.sortBy
    ? [
        {
          id: props.sortBy === 'name' ? 'identity' : props.sortBy,
          desc: props.sortDirection === 'desc',
        },
      ]
    : localSorting;
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const debug = props.debug || props.viewMode === 'debug';
  const data = connections;
  const item = (enriched: EnrichedConnection, part: 'identity' | 'actions') => (
    <ConnectionTableItem
      enriched={enriched}
      part={part}
      visibleColumns={props.visibleColumns}
      customGroups={props.customGroups}
      selectedId={props.selectedId}
      onToggleFavorite={() => props.onToggleFavorite(enriched.connection.id)}
      onAssignToGroup={(id) => props.onAssignToGroup(id, enriched.connection.id)}
      onRemoveFromGroup={
        props.onRemoveFromGroup
          ? (id) => props.onRemoveFromGroup?.(id, enriched.connection.id)
          : undefined
      }
      onCreateFolder={props.onCreateFolder}
      onDelete={() => props.onDeleteRequest(enriched.connection.id, enriched.displayName)}
    />
  );
  const columns: DataTableColumnDef<EnrichedConnection>[] = [
    {
      id: 'identity',
      header: 'Cluster',
      accessorFn: (row) => row.displayName,
      size: 300,
      enableHiding: false,
      cell: ({ row }) => item(row.original, 'identity'),
    },
    { id: 'provider', header: 'Provider', accessorFn: (row) => row.provider, size: 130 },
    ...(['region', 'account', 'environment'] as const).map((key) => ({
      id: `fact:${key}`,
      header: key === 'environment' ? 'Environment' : key === 'account' ? 'Account / Project' : 'Region',
      accessorFn: (row: EnrichedConnection) => {
        const facts = getClusterDisplayFacts(row);
        return (key === 'account' ? facts.account ?? facts.project : facts[key])?.value ?? '';
      },
      size: 160,
      cell: ({ row }: { row: { original: EnrichedConnection } }) => {
        const facts = getClusterDisplayFacts(row.original);
        if (key === 'account' && !facts.account && facts.project) {
          return <>Project: {factCell(facts.project)}</>;
        }
        return factCell(facts[key]);
      },
    })),
    {
      id: 'status',
      header: 'Connection',
      accessorFn: (row) => (row.isConnected ? 'Connected' : 'Disconnected'),
      size: 140,
    },
    {
      id: 'recency',
      header: 'Last opened',
      accessorFn: (row) => row.lastAccessed ?? 0,
      size: 160,
      cell: ({ row }) =>
        row.original.lastAccessed ? new Date(row.original.lastAccessed).toLocaleString() : 'Never',
    },
    {
      id: 'metadata',
      header: 'Metadata',
      accessorFn: (row: EnrichedConnection) => getClusterDisplayFacts(row).metadataState,
      size: 130,
    },
    ...(debug
      ? [
          {
            id: 'workloads',
            header: 'Workloads',
            accessorFn: () => 'Unknown — not queried',
            size: 200,
            enableSorting: false,
          },
          {
            id: 'metrics',
            header: 'Metrics',
            accessorFn: () => 'Unknown — provider required',
            size: 230,
            enableSorting: false,
          },
        ]
      : []),
    ...props.allLabelKeys.map((key) => ({
      id: `label:${key}`,
      header: key,
      size: 180,
      accessorFn: (row: EnrichedConnection) => String(row.connection.labels?.[key] ?? ''),
    })),
    {
      id: 'actions',
      header: 'Actions',
      size: 90,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => item(row.original, 'actions'),
    },
  ];
  const columnVisibility = {
    recency: false,
    metadata: debug,
    ...coreVisibility,
    ...Object.fromEntries(
      props.allLabelKeys.map((key) => [`label:${key}`, props.visibleColumns.includes(key)]),
    ),
  };
  const table = useDataTable({
    data,
    columns,
    features,
    getRowId: (row) => row.connection.id,
    state: { columnVisibility, sorting },
    manualSorting: !!props.sortBy,
    enableMultiSort: false,
    onSortingChange: (next) => {
      if (!props.onSortChange) {
        setLocalSorting(next);
        return;
      }
      const sort = next[0];
      const field = sort?.id === 'identity' || !sort ? 'name' : (sort.id as SortByField);
      props.onSortChange(field, sort?.desc ? 'desc' : 'asc');
    },
    onColumnVisibilityChange: (next) => {
      setCoreVisibility(next);
      for (const key of props.allLabelKeys) {
        if ((next[`label:${key}`] !== false) !== props.visibleColumns.includes(key))
          props.onToggleColumn(key);
      }
    },
  });
  const visualIds = table.getRowModel().rows.map((row) => row.original.connection.id);
  const visualKey = JSON.stringify(visualIds);
  React.useEffect(() => {
    props.onVisualOrderChange?.(visualIds);
  }, [visualKey, props.onVisualOrderChange]);
  React.useEffect(() => {
    if (!props.selectedId) return;
    const index = visualIds.indexOf(props.selectedId);
    if (index < 0) return;
    if (data.length > 100 && scrollRef.current) {
      scrollRef.current.scrollTop = index * (compact ? 40 : 48);
      scrollRef.current.dispatchEvent(new Event('scroll'));
    }
    const frame = requestAnimationFrame(() => {
      const action = [
        ...(scrollRef.current?.querySelectorAll<HTMLElement>('[data-cluster-open]') ?? []),
      ].find((node) => node.dataset.clusterOpen === props.selectedId);
      action?.scrollIntoView?.({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [props.selectedId, visualKey, compact, data.length]);
  return (
    <DataTable
      table={table}
      features={features}
      size={compact ? 'sm' : 'md'}
      hoverable
      stickyHeader
    >
      <DataTable.Toolbar>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCompact((value) => !value)}
          aria-label="Toggle table density"
        >
          {compact ? 'Comfortable rows' : 'Compact rows'}
        </Button>
        <DataTable.ColumnVisibility />
      </DataTable.Toolbar>
      <DataTable.Container ref={scrollRef} style={{ maxHeight: 'min(70vh, 800px)' }}>
        <DataTable.Header />
        {data.length > 100 ? (
          <DataTable.VirtualBody estimateRowSize={compact ? 40 : 48} overscan={12} />
        ) : (
          <DataTable.Body />
        )}
      </DataTable.Container>
    </DataTable>
  );
}

const ConnectionTable: React.FC<Props> = (input) => {
  const debug = input.debug || input.viewMode === 'debug';
  const debugConnections = debug
    ? [
        ...new Map(
          input.grouped.groups.flatMap((group) =>
            group.connections.map((connection) => [connection.connection.id, connection] as const),
          ),
        ).values(),
      ]
    : [];
  const props = debug
    ? {
        ...input,
        groupBy: 'none' as const,
        grouped: {
          ...input.grouped,
          groups: [{ key: 'debug', label: 'Debug', connections: debugConnections }],
        },
      }
    : input;
  const isFlat = props.groupBy === 'none';
  const orders = React.useRef<Record<string, string[]>>({});
  const lastOrder = React.useRef('');
  const groupKeys = props.grouped.groups.map((group) => group.key).join('\u0000');
  const onVisualOrderChange = React.useCallback(
    (ids: string[]) => {
      const uniqueIds = [...new Set(ids)];
      const key = JSON.stringify(uniqueIds);
      if (key === lastOrder.current) return;
      lastOrder.current = key;
      props.onVisualOrderChange?.(uniqueIds);
    },
    [props.onVisualOrderChange],
  );
  const orderCallbacks = React.useMemo(
    () =>
      Object.fromEntries(
        props.grouped.groups.map((group) => [
          group.key,
          (ids: string[]) => {
            orders.current[group.key] = ids;
            onVisualOrderChange?.(
              props.grouped.groups
                .filter((section) => !props.collapsedGroups.has(section.key))
                .flatMap(
                  (section) =>
                    orders.current[section.key] ??
                    section.connections.map((row) => row.connection.id),
                ),
            );
          },
        ]),
      ),
    [groupKeys, props.grouped, props.collapsedGroups, onVisualOrderChange],
  );
  React.useEffect(() => {
    if (props.viewMode === 'grid' && !debug) {
      onVisualOrderChange?.(
        props.grouped.groups
          .filter((group) => !props.collapsedGroups.has(group.key))
          .flatMap((group) => group.connections.map((row) => row.connection.id)),
      );
    }
  }, [props.grouped, props.collapsedGroups, props.viewMode, debug, onVisualOrderChange]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {props.grouped.groups.map((group) => (
        <ConnectionGroupComp
          key={group.key}
          groupKey={group.key}
          label={group.label}
          count={group.connections.length}
          provider={group.provider}
          isCollapsed={props.collapsedGroups.has(group.key)}
          onToggleCollapse={() => props.onToggleCollapse(group.key)}
          hideHeader={isFlat}
        >
          {props.viewMode === 'grid' && !debug ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
                gridAutoRows: '1fr',
                gap: 12,
                padding: isFlat ? 0 : 8,
              }}
            >
              {group.connections.map((enriched) => (
                <GridCardWrapper key={enriched.connection.id} {...props} enriched={enriched} />
              ))}
            </div>
          ) : (
            <TableSection
              {...props}
              connections={group.connections}
              onVisualOrderChange={orderCallbacks[group.key]}
            />
          )}
        </ConnectionGroupComp>
      ))}
    </div>
  );
};

export default ConnectionTable;
