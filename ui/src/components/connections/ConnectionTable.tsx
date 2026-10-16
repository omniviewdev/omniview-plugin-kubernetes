import { IconButton, Text } from '@omniviewdev/base-ui';
import {
  usePluginContext,
  useConnection,
  useSnackbar,
  usePluginRouter,
} from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';
import React from 'react';
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu';

import type {
  GroupedConnectionsResult,
  GroupByMode,
  ViewMode,
  ConnectionGroup,
  EnrichedConnection,
} from '../../types/clusters';

import ColumnPicker from './ColumnPicker';
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
  onRecordAccess: (connectionId: string) => void;
};

const getColumnWidth = (connections: EnrichedConnection[], col: string) => {
  const px = 7;
  const maxLabelWidth = 400;
  let width = 0;

  for (const { connection } of connections) {
    if (!connection.labels) continue;
    // connection.labels is Record<string, any> from the runtime SDK
    const labels = connection.labels as Record<string, string | undefined>;
    const val = labels[col];
    if (val) {
      const calcedWidth = String(val).length * px;
      if (calcedWidth > width) {
        width = calcedWidth > maxLabelWidth ? maxLabelWidth : calcedWidth;
      }
    }
  }

  return width;
};

/**
 * Helper sub-component for grid view of a single connection.
 * Handles connect/disconnect via hooks.
 */
const GridCardWrapper: React.FC<{
  enriched: EnrichedConnection;
  customGroups: ConnectionGroup[];
  onToggleFavorite: () => void;
  onAssignToGroup: (groupId: string) => void;
  onRemoveFromGroup?: (groupId: string) => void;
  onCreateFolder?: (connectionId: string) => void;
  onDelete: () => void;
  onRecordAccess: () => void;
}> = ({
  enriched,
  customGroups,
  onToggleFavorite,
  onAssignToGroup,
  onRemoveFromGroup,
  onCreateFolder,
  onDelete,
  onRecordAccess,
}) => {
  const { meta } = usePluginContext();
  const { navigate } = usePluginRouter();
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { showSnackbar } = useSnackbar();
  const { startConnection, stopConnection } = useConnection({
    pluginID: meta.id,
    connectionID: enriched.connection.id,
  });

  const handleClick = () => {
    onRecordAccess();
    if (enriched.isConnected) {
      navigate(`/cluster/${encodeURIComponent(enriched.connection.id)}/resources`);
      return;
    }
    startConnection()
      .then((status) => {
        if (status.status === types.ConnectionStatusCode.ConnectionStatusConnected) {
          navigate(`/cluster/${encodeURIComponent(enriched.connection.id)}/resources`);
        }
      })
      .catch((err) => {
        if (err instanceof Error) {
          showSnackbar({ status: 'error', message: err.message, icon: 'LuCircleAlert' });
        }
      });
  };

  const handleConnect = () => {
    onRecordAccess();
    startConnection().catch((err) => {
      if (err instanceof Error) {
        showSnackbar({ status: 'error', message: err.message, icon: 'LuCircleAlert' });
      }
    });
  };

  const handleDisconnect = () => {
    stopConnection().catch((err) => {
      if (err instanceof Error) {
        showSnackbar({ status: 'error', message: err.message, icon: 'LuCircleAlert' });
      }
    });
  };

  const handleCopyId = () => {
    void navigator.clipboard.writeText(enriched.connection.id);
    showSnackbar({ status: 'success', message: 'Connection ID copied' });
  };

  return (
    <ConnectionCard
      enriched={enriched}
      customGroups={customGroups}
      onClick={handleClick}
      onToggleFavorite={onToggleFavorite}
      onConnect={handleConnect}
      onDisconnect={handleDisconnect}
      onAssignToGroup={onAssignToGroup}
      onRemoveFromGroup={onRemoveFromGroup}
      onCreateFolder={onCreateFolder}
      onCopyId={handleCopyId}
      onDelete={onDelete}
    />
  );
};

const gridContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const paginationStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '12px 0',
};

const tableWrapperStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 'var(--ov-radius-md, 6px)',
  overflow: 'auto',
  border: '1px solid var(--ov-color-border-default)',
  backgroundColor: 'var(--ov-color-bg-surface)',
};

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };

const theadRowStyle: React.CSSProperties = {
  backgroundColor: 'var(--ov-color-bg-inset)',
  height: 28,
};

const columnHeaderStyle: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const columnPickerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  position: 'relative',
};

/* ---- shared table styles ---- */
const thStyle: React.CSSProperties = {
  padding: '2px 8px',
  textAlign: 'left',
  verticalAlign: 'middle',
  borderBottom: '1px solid var(--ov-color-border-muted)',
  whiteSpace: 'nowrap',
  height: 28,
};

const ConnectionTable: React.FC<Props> = ({
  grouped,
  groupBy,
  viewMode,
  customGroups,
  collapsedGroups,
  visibleColumns,
  allLabelKeys,
  onToggleColumn,
  onToggleCollapse,
  onToggleFavorite,
  onAssignToGroup,
  onRemoveFromGroup,
  onCreateFolder,
  onDeleteRequest,
  onRecordAccess,
}) => {
  const allConnections = grouped.groups.flatMap((g) => g.connections);
  const isFlat = groupBy === 'none';

  const PAGE_SIZE = 40;
  const [page, setPage] = React.useState(0);

  // Reset to first page when source data changes
  const dataKey = grouped.groups.map((g) => g.key).join(',');
  React.useEffect(() => {
    setPage(0);
  }, [dataKey]);

  if (viewMode === 'grid') {
    return (
      <div style={gridContainerStyle}>
        {grouped.groups.map((group) => {
          // Paginate only flat (ungrouped) views
          const connections = isFlat
            ? group.connections.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
            : group.connections;
          const totalPages = isFlat ? Math.ceil(group.connections.length / PAGE_SIZE) : 1;

          return (
            <ConnectionGroupComp
              key={group.key}
              groupKey={group.key}
              label={group.label}
              count={group.connections.length}
              provider={group.provider}
              isCollapsed={collapsedGroups.has(group.key)}
              onToggleCollapse={() => onToggleCollapse(group.key)}
              hideHeader={isFlat}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
                  gap: 12,
                  padding: isFlat ? 0 : 8,
                }}
              >
                {connections.map((enriched) => (
                  <GridCardWrapper
                    key={enriched.connection.id}
                    enriched={enriched}
                    customGroups={customGroups}
                    onToggleFavorite={() => onToggleFavorite(enriched.connection.id)}
                    onAssignToGroup={(gId) => onAssignToGroup(gId, enriched.connection.id)}
                    onRemoveFromGroup={
                      onRemoveFromGroup
                        ? (gId) => onRemoveFromGroup(gId, enriched.connection.id)
                        : undefined
                    }
                    onCreateFolder={onCreateFolder}
                    onDelete={() => onDeleteRequest(enriched.connection.id, enriched.displayName)}
                    onRecordAccess={() => onRecordAccess(enriched.connection.id)}
                  />
                ))}
              </div>
              {isFlat && totalPages > 1 && (
                <div style={paginationStyle}>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    color="neutral"
                    aria-label="Previous page"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <LuChevronLeft size={16} />
                  </IconButton>
                  <Text size="sm" tone="muted">
                    Page {page + 1} of {totalPages}
                  </Text>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    color="neutral"
                    aria-label="Next page"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <LuChevronRight size={16} />
                  </IconButton>
                </div>
              )}
            </ConnectionGroupComp>
          );
        })}
      </div>
    );
  }

  // List view - only render visible label columns
  const sortedVisibleCols = visibleColumns
    .filter((c) => allConnections.some((e) => {
      // connection.labels is Record<string, any> from the runtime SDK
      const labels = e.connection.labels as Record<string, string | undefined> | undefined;
      return labels?.[c] !== undefined;
    }))
    .sort();

  return (
    <div style={gridContainerStyle}>
      {grouped.groups.map((group) => (
        <ConnectionGroupComp
          key={group.key}
          groupKey={group.key}
          label={group.label}
          count={group.connections.length}
          provider={group.provider}
          isCollapsed={collapsedGroups.has(group.key)}
          onToggleCollapse={() => onToggleCollapse(group.key)}
          hideHeader={isFlat}
        >
          <div style={tableWrapperStyle}>
            <table
              aria-label="connections table"
              style={tableStyle}
            >
              <thead>
                <tr
                  style={theadRowStyle}
                >
                  <th style={{ ...thStyle, width: 32, padding: '2px 4px' }} />
                  <th style={{ ...thStyle, width: '40%' }}>
                    <Text size="xs" weight="semibold" tone="muted" style={columnHeaderStyle}>
                      Name
                    </Text>
                  </th>
                  {sortedVisibleCols.map((col) => (
                    <th
                      key={col}
                      style={{
                        ...thStyle,
                        width: getColumnWidth(allConnections, col) + 8,
                      }}
                    >
                      <Text size="xs" weight="semibold" tone="muted" style={columnHeaderStyle}>
                        {col.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </Text>
                    </th>
                  ))}
                  <th style={{ ...thStyle, width: 36, padding: '0 4px', position: 'relative', textAlign: 'right' }}>
                    <div style={columnPickerStyle}>
                      <ColumnPicker
                        allColumns={allLabelKeys}
                        visibleColumns={visibleColumns}
                        onToggleColumn={onToggleColumn}
                      />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.connections.map((enriched) => (
                  <ConnectionTableItem
                    key={enriched.connection.id}
                    enriched={enriched}
                    visibleColumns={sortedVisibleCols}
                    customGroups={customGroups}
                    onToggleFavorite={() => onToggleFavorite(enriched.connection.id)}
                    onAssignToGroup={(gId) => onAssignToGroup(gId, enriched.connection.id)}
                    onRemoveFromGroup={
                      onRemoveFromGroup
                        ? (gId) => onRemoveFromGroup(gId, enriched.connection.id)
                        : undefined
                    }
                    onCreateFolder={onCreateFolder}
                    onDelete={() => onDeleteRequest(enriched.connection.id, enriched.displayName)}
                    onRecordAccess={() => onRecordAccess(enriched.connection.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </ConnectionGroupComp>
      ))}
    </div>
  );
};

export default ConnectionTable;
