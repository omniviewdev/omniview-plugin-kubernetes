import { Avatar, Card, Stack, Text } from '@omniviewdev/base-ui';
import React from 'react';

import type { EnrichedConnection, ConnectionGroup } from '../../types/clusters';
import NamedAvatar from '../shared/NamedAvatar';

import ConnectionContextMenu from './ConnectionContextMenu';
import styles from './Connections.module.css';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import FavoriteButton from './FavoriteButton';
import ProviderIcon from './ProviderIcon';

const cardBodyStyle: React.CSSProperties = { padding: 12 };

const avatarStyle: React.CSSProperties = {
  borderRadius: 6,
  backgroundColor: 'transparent',
  maxHeight: 28,
  maxWidth: 28,
};

const headerContentStyle: React.CSSProperties = { flex: 1, minWidth: 0 };

const descriptionStyle: React.CSSProperties = { opacity: 0.7 };

const detailsContentStyle: React.CSSProperties = { flex: 1, minWidth: 0 };

const kubeconfigStyle: React.CSSProperties = { opacity: 0.6 };

const userStyle: React.CSSProperties = { opacity: 0.6 };

const actionsContainerStyle: React.CSSProperties = { flexShrink: 0 };

type Props = {
  enriched: EnrichedConnection;
  customGroups: ConnectionGroup[];
  onClick: () => void;
  onToggleFavorite: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onAssignToGroup: (groupId: string) => void;
  onRemoveFromGroup?: (groupId: string) => void;
  onCreateFolder?: (connectionId: string) => void;
  onCopyId: () => void;
  onDelete: () => void;
};

const ConnectionCard: React.FC<Props> = ({
  enriched,
  customGroups,
  onClick,
  onToggleFavorite,
  onConnect,
  onDisconnect,
  onAssignToGroup,
  onRemoveFromGroup,
  onCreateFolder,
  onCopyId,
  onDelete,
}) => {
  const { connection, provider, isFavorite, isConnected, displayName, displayDescription } =
    enriched;

  return (
    <Card variant="outline" className={styles.connectionCard} onClick={onClick}>
      <Stack direction="column" style={{ ...cardBodyStyle, gap: 6 }}>
        {/* Header row */}
        <Stack direction="row" align="center" spacing={2}>
          <ConnectionStatusBadge isConnected={isConnected}>
            {enriched.avatar ? (
              <Avatar size="sm" shape="rounded" src={enriched.avatar} style={avatarStyle} />
            ) : (
              <NamedAvatar value={displayName} color={enriched.avatarColor} />
            )}
          </ConnectionStatusBadge>
          <Stack direction="column" style={headerContentStyle}>
            <Text weight="semibold" size="sm" truncate>
              {displayName}
            </Text>
            {displayDescription && (
              <Text size="xs" truncate style={descriptionStyle}>
                {displayDescription}
              </Text>
            )}
          </Stack>
          <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
        </Stack>

        {/* Details + context menu */}
        <Stack direction="row" align="end" spacing={1}>
          <Stack direction="column" style={{ ...detailsContentStyle, gap: 2 }}>
            <Stack direction="row" align="center" style={{ gap: 6 }}>
              <ProviderIcon provider={provider} size={14} />
              <Text size="xs">{String(connection.labels?.cluster ?? '')}</Text>
            </Stack>
            {connection.labels?.kubeconfig && (
              <Text size="xs" truncate style={kubeconfigStyle}>
                {String(connection.labels.kubeconfig)}
              </Text>
            )}
            {connection.labels?.user && (
              <Text size="xs" style={userStyle}>
                {String(connection.labels.user)}
              </Text>
            )}
          </Stack>
          <Stack
            direction="row"
            align="center"
            style={actionsContainerStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <ConnectionContextMenu
              connectionId={connection.id}
              connectionName={displayName}
              isConnected={isConnected}
              isFavorite={isFavorite}
              customGroups={customGroups}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onToggleFavorite={onToggleFavorite}
              onAssignToGroup={onAssignToGroup}
              onRemoveFromGroup={onRemoveFromGroup}
              onCreateFolder={onCreateFolder}
              onCopyId={onCopyId}
              onDelete={onDelete}
            />
          </Stack>
        </Stack>
      </Stack>
    </Card>
  );
};

export default ConnectionCard;
