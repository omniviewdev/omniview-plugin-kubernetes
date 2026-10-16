import { Avatar, Chip, Spinner, Text } from '@omniviewdev/base-ui';
import {
  usePluginRouter,
  usePluginContext,
  useConnection,
  useSnackbar,
} from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';
import React from 'react';

import type { EnrichedConnection, ConnectionGroup } from '../../types/clusters';
import NamedAvatar from '../shared/NamedAvatar';

import ConnectionContextMenu from './ConnectionContextMenu';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import FavoriteButton from './FavoriteButton';
import ProviderIcon from './ProviderIcon';

type Props = {
  enriched: EnrichedConnection;
  visibleColumns: string[];
  customGroups: ConnectionGroup[];
  onToggleFavorite: () => void;
  onAssignToGroup: (groupId: string) => void;
  onRemoveFromGroup?: (groupId: string) => void;
  onCreateFolder?: (connectionId: string) => void;
  onDelete: () => void;
  onRecordAccess: () => void;
};

const rowStyle = { cursor: 'pointer' } as const;

const nameRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
};

const descriptionStyle: React.CSSProperties = { flexShrink: 1, minWidth: 0 };

const truncate = (input: string) => (input.length > 60 ? `${input.substring(0, 60)}...` : input);

const tdSx: React.CSSProperties = {
  padding: '3px 8px',
  verticalAlign: 'middle',
  borderBottom: '1px solid var(--ov-color-border-muted)',
};

const ConnectionTableItem: React.FC<Props> = ({
  enriched,
  visibleColumns,
  customGroups,
  onToggleFavorite,
  onAssignToGroup,
  onRemoveFromGroup,
  onCreateFolder,
  onDelete,
  onRecordAccess,
}) => {
  const { connection, provider, isFavorite, isConnected, displayName, displayDescription } =
    enriched;
  const { id, labels } = connection;

  const { meta } = usePluginContext();
  const { navigate } = usePluginRouter();
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { showSnackbar } = useSnackbar();
  const { startConnection, stopConnection } = useConnection({
    pluginID: meta.id,
    connectionID: id,
  });
  const [connecting, setConnecting] = React.useState(false);

  const handleConnectionStatus = (status: types.ConnectionStatus) => {
    switch (status.status) {
      case types.ConnectionStatusCode.ConnectionStatusUnauthorized:
        showSnackbar({
          status: 'warning',
          message: `Failed to authorize to '${displayName}'`,
          details: status.details,
          icon: 'LuShieldClose',
        });
        break;
      case types.ConnectionStatusCode.ConnectionStatusConnected:
        showSnackbar({
          status: 'success',
          message: `Connected to '${displayName}'`,
          icon: 'LuCheckCircle',
        });
        navigate(`/cluster/${encodeURIComponent(id)}/resources`);
        break;
      default:
        showSnackbar({
          status: 'error',
          message: `Failed to connect to '${displayName}'`,
          details: status.details,
          icon: 'LuCircleAlert',
        });
    }
  };

  const handleClick = () => {
    onRecordAccess();
    if (isConnected) {
      navigate(`/cluster/${encodeURIComponent(id)}/resources`);
      return;
    }
    setConnecting(true);
    startConnection()
      .then((status) => handleConnectionStatus(status))
      .catch((err) => {
        if (err instanceof Error) {
          showSnackbar({
            status: 'error',
            message: err.message,
            icon: 'LuCircleAlert',
          });
        }
      })
      .finally(() => setConnecting(false));
  };

  const handleConnect = () => {
    onRecordAccess();
    setConnecting(true);
    startConnection()
      .then((status) => handleConnectionStatus(status))
      .catch((err) => {
        if (err instanceof Error) {
          showSnackbar({ status: 'error', message: err.message, icon: 'LuCircleAlert' });
        }
      })
      .finally(() => setConnecting(false));
  };

  const handleDisconnect = () => {
    stopConnection().catch((err) => {
      if (err instanceof Error) {
        showSnackbar({ status: 'error', message: err.message, icon: 'LuCircleAlert' });
      }
    });
  };

  const handleCopyId = () => {
    void navigator.clipboard.writeText(id);
    showSnackbar({ status: 'success', message: 'Connection ID copied' });
  };

  return (
    <tr
      id={`connection-${id}`}
      style={rowStyle}
      onMouseOver={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor =
          'var(--ov-color-state-hover)';
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor =
          'var(--ov-color-state-hover)';
      }}
      onMouseOut={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = '';
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = '';
      }}
    >
      {/* Favorite */}
      <td style={{ ...tdSx, width: 32, padding: '3px 4px', textAlign: 'center' }}>
        <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
      </td>

      {/* Name */}
      <td onClick={handleClick} style={{ ...tdSx }}>
        <div style={nameRowStyle}>
          <ConnectionStatusBadge isConnected={isConnected}>
            {enriched.avatar ? (
              <Avatar size="sm" shape="rounded" src={enriched.avatar} />
            ) : (
              <NamedAvatar value={displayName} color={enriched.avatarColor} />
            )}
          </ConnectionStatusBadge>
          <ProviderIcon provider={provider} size={14} />
          <Text weight="semibold" size="sm" truncate>
            {displayName}
          </Text>
          {Boolean(displayDescription) && (
            <Text size="xs" tone="subtle" truncate style={descriptionStyle}>
              {displayDescription}
            </Text>
          )}
          {enriched.tags.length > 0 &&
            enriched.tags.map((tag) => (
              <Chip key={tag} size="xs" variant="soft" color="warning">
                {tag}
              </Chip>
            ))}
          {connecting && <Spinner size="xs" />}
        </div>
      </td>

      {/* Visible label columns */}
      {visibleColumns.map((col) => (
        <td key={`${id}-${col}`} onClick={handleClick} style={{ ...tdSx }}>
          {labels?.[col] ? (
            <Text size="xs" tone="muted" truncate>
              {truncate(String(labels[col]))}
            </Text>
          ) : null}
        </td>
      ))}

      {/* Actions */}
      <td onClick={(e) => e.stopPropagation()} style={{ ...tdSx, width: 36, textAlign: 'center' }}>
        <ConnectionContextMenu
          connectionId={id}
          connectionName={displayName}
          isConnected={isConnected}
          isFavorite={isFavorite}
          customGroups={customGroups}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onToggleFavorite={onToggleFavorite}
          onAssignToGroup={onAssignToGroup}
          onRemoveFromGroup={onRemoveFromGroup}
          onCreateFolder={onCreateFolder}
          onCopyId={handleCopyId}
          onDelete={onDelete}
        />
      </td>
    </tr>
  );
};

export default ConnectionTableItem;
