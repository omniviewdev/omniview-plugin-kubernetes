import { Avatar, Card } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';

import type { EnrichedConnection, ConnectionGroup } from '../../types/clusters';
import NamedAvatar from '../shared/NamedAvatar';

import ConnectionContextMenu from './ConnectionContextMenu';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import FavoriteButton from './FavoriteButton';
import ProviderIcon from './ProviderIcon';

const cardSx = {
  cursor: 'pointer',
  '&:hover': { borderColor: 'primary.outlinedHoverBorder', boxShadow: 'sm' },
  transition: 'border-color 0.15s, box-shadow 0.15s',
} as const;

const avatarSx = {
  borderRadius: 6,
  backgroundColor: 'transparent',
  maxHeight: 28,
  maxWidth: 28,
} as const;

const headerContentSx = { flex: 1, minWidth: 0 } as const;

const descriptionSx = { opacity: 0.7 } as const;

const detailsContentSx = { flex: 1, minWidth: 0 } as const;

const kubeconfigSx = { opacity: 0.6 } as const;

const userSx = { opacity: 0.6 } as const;

const actionsContainerSx = { flexShrink: 0 } as const;

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
    <Card
      variant="outlined"
      sx={cardSx}
      onClick={onClick}
    >
      <Stack gap={0.75}>
        {/* Header row */}
        <Stack direction="row" alignItems="center" gap={1}>
          <ConnectionStatusBadge isConnected={isConnected}>
            {enriched.avatar ? (
              <Avatar
                size="sm"
                src={enriched.avatar}
                sx={avatarSx}
              />
            ) : (
              <NamedAvatar value={displayName} color={enriched.avatarColor} />
            )}
          </ConnectionStatusBadge>
          <Stack sx={headerContentSx}>
            <Text weight="semibold" size="sm" noWrap>
              {displayName}
            </Text>
            {displayDescription && (
              <Text size="xs" noWrap sx={descriptionSx}>
                {displayDescription}
              </Text>
            )}
          </Stack>
          <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
        </Stack>

        {/* Details + context menu */}
        <Stack direction="row" alignItems="flex-end" gap={0.5}>
          <Stack gap={0.25} sx={detailsContentSx}>
            <Stack direction="row" alignItems="center" gap={0.75}>
              <ProviderIcon provider={provider} size={14} />
              <Text size="xs">{String(connection.labels?.cluster ?? '')}</Text>
            </Stack>
            {connection.labels?.kubeconfig && (
              <Text size="xs" noWrap sx={kubeconfigSx}>
                {String(connection.labels.kubeconfig)}
              </Text>
            )}
            {connection.labels?.user && (
              <Text size="xs" sx={userSx}>
                {String(connection.labels.user)}
              </Text>
            )}
          </Stack>
          <Stack
            direction="row"
            alignItems="center"
            sx={actionsContainerSx}
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
