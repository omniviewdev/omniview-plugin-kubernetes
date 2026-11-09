import { Avatar, Button, Spinner } from '@omniviewdev/base-ui';
import { useNotifications } from '@omniviewdev/runtime';
import React from 'react';

import { useClusterAction } from '../../hooks/useClusterAction';
import type { EnrichedConnection, ConnectionGroup } from '../../types/clusters';
import NamedAvatar from '../shared/NamedAvatar';

import ConnectionContextMenu from './ConnectionContextMenu';
import FavoriteButton from './FavoriteButton';
import ProviderIcon from './ProviderIcon';
import { ClusterDragHandle } from './ClusterOrganization';

type Props = {
  enriched: EnrichedConnection;
  visibleColumns: string[];
  customGroups: ConnectionGroup[];
  onToggleFavorite: () => void;
  onAssignToGroup: (groupId: string) => void;
  onRemoveFromGroup?: (groupId: string) => void;
  onCreateFolder?: (connectionId: string) => void;
  onDelete: () => void;
  selectedId?: string;
  part?: 'identity' | 'actions';
};

/** Native controls inside DataTable cells; the table owns row layout and focus. */
const ConnectionTableItem: React.FC<Props> = ({
  enriched,
  customGroups,
  onToggleFavorite,
  onAssignToGroup,
  onRemoveFromGroup,
  onCreateFolder,
  onDelete,
  selectedId,
  part = 'identity',
}) => {
  const { connection, displayName, isConnected, isFavorite, provider } = enriched;
  const { handleClick, handleConnect, handleDisconnect, connecting } = useClusterAction(
    connection.id,
    isConnected,
  );
  const { notify } = useNotifications();
  const handleCopyId = () => {
    void navigator.clipboard.writeText(connection.id).then(
      () => {
        void notify({ severity: 'success', title: 'Connection ID copied' });
      },
      (error: unknown) => {
        void notify({
          severity: 'error',
          title: error instanceof Error ? error.message : 'Failed to copy connection ID',
        });
      },
    );
  };

  if (part === 'actions')
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <ClusterDragHandle connectionId={connection.id} />
        <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
        <ConnectionContextMenu
          enriched={enriched}
          connectionId={connection.id}
          connectionName={displayName}
          isConnected={isConnected}
          isFavorite={isFavorite}
          customGroups={customGroups}
          onConnect={() => { void handleConnect(); }}
          onDisconnect={() => { void handleDisconnect(); }}
          onToggleFavorite={onToggleFavorite}
          onAssignToGroup={onAssignToGroup}
          onRemoveFromGroup={onRemoveFromGroup}
          onCreateFolder={onCreateFolder}
          onCopyId={handleCopyId}
          onDelete={onDelete}
        />
      </div>
    );

  return (
    <Button
      variant={selectedId === connection.id ? 'soft' : 'ghost'}
      size="sm"
      color="neutral"
      onClick={() => { void handleClick(); }}
      data-cluster-open={connection.id}
      aria-label={`Open ${displayName}`}
      aria-current={selectedId === connection.id ? 'true' : undefined}
      aria-description={[
        `Context: ${connection.name || connection.id}`,
        connection.id,
        enriched.displayDescription,
        enriched.tags.join(', '),
      ]
        .filter(Boolean)
        .join('\n')}
      title={[...new Set([displayName, connection.name, connection.id, enriched.displayDescription].filter(Boolean))].join('\n')}
      disabled={connecting}
      style={{ maxWidth: '100%', justifyContent: 'flex-start' }}
    >
      {enriched.avatar ? (
        <Avatar size="xs" shape="rounded" src={enriched.avatar} alt="" />
      ) : (
        <NamedAvatar value={displayName} color={enriched.avatarColor} />
      )}
      <ProviderIcon provider={provider} size={14} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {displayName}
      </span>
      {connecting && <Spinner size="xs" aria-label="Connecting" />}
    </Button>
  );
};

export default ConnectionTableItem;
