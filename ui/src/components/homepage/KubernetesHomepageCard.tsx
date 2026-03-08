import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import { LuFolder } from 'react-icons/lu';
import { Avatar } from '@omniviewdev/ui';
import { Text } from '@omniviewdev/ui/typography';
import { useConnections, useConnectionStatus } from '@omniviewdev/runtime';
import type { HomepageCardProps } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import { type types } from '@omniviewdev/runtime/models';
import { useClusterPreferences } from '../../hooks/useClusterPreferences';
import type { ConnectionOverride, ConnectionGroup } from '../../types/clusters';
import ConnectionStatusBadge from '../connections/ConnectionStatusBadge';
import NamedAvatar from '../shared/NamedAvatar';

const PLUGIN_ID = 'kubernetes';

// ── Shared styles ─────────────────────────────────────────────────────────────

const chipSx = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.75,
  pl: 0.5,
  pr: 1,
  py: 0.375,
  cursor: 'pointer',
  borderRadius: '5px',
  border: '1px solid var(--ov-border-default, rgba(255,255,255,0.08))',
  bgcolor: 'var(--ov-bg-surface, rgba(255,255,255,0.03))',
  transition: 'border-color 0.15s, background-color 0.15s, box-shadow 0.15s',
  maxWidth: 200,
  minWidth: 0,
  '&:hover': {
    borderColor: 'var(--ov-border-emphasis, rgba(255,255,255,0.2))',
    bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.06))',
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
  },
  '&:hover .chip-disconnect': {
    opacity: 1,
  },
} as const;

const chipNameSx = {
  fontSize: '0.75rem',
  fontWeight: 500,
  color: 'var(--ov-fg-base)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
} as const;

const avatarSx = { borderRadius: '50%', bgcolor: 'transparent' } as const;

const chipGridSx = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 0.75,
} as const;

// ── Sub-components ────────────────────────────────────────────────────────────

const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
  <Box sx={{ px: 0.5, pt: 1.25, pb: 0.5 }}>
    <Text
      size="xs"
      sx={{ color: 'var(--ov-fg-faint, rgba(255,255,255,0.4))', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}
    >
      {title}
    </Text>
  </Box>
);

const EmptySectionNote: React.FC<{ message: string }> = ({ message }) => (
  <Box sx={{ px: 0.5, py: 0.5 }}>
    <Text size="xs" sx={{ color: 'var(--ov-fg-faint, rgba(255,255,255,0.35))' }}>
      {message}
    </Text>
  </Box>
);

type ClusterChipProps = {
  conn: types.Connection | undefined;
  id: string;
  override?: ConnectionOverride;
  isConnected: boolean;
  isSyncing?: boolean;
  hasErrors?: boolean;
  onClick: () => void;
  onDisconnect?: (e: React.MouseEvent) => void;
};

const ClusterChip: React.FC<ClusterChipProps> = ({
  conn,
  id,
  override,
  isConnected,
  isSyncing,
  hasErrors,
  onClick,
  onDisconnect,
}) => {
  const displayName = override?.displayName ?? conn?.name ?? id;
  const avatar = override?.avatar ?? conn?.avatar;
  const avatarColor = override?.avatarColor;

  return (
    <Box sx={chipSx} onClick={onClick}>
      <ConnectionStatusBadge isConnected={isConnected}>
        {avatar ? (
          <Avatar size="sm" src={avatar} sx={avatarSx} />
        ) : (
          <NamedAvatar value={displayName} color={avatarColor} />
        )}
      </ConnectionStatusBadge>

      <Box component="span" sx={chipNameSx}>
        {displayName}
      </Box>

      {isSyncing && (
        <CircularProgress size={9} sx={{ flexShrink: 0, color: 'var(--ov-fg-faint)' }} />
      )}
      {!isSyncing && hasErrors && (
        <Chip
          label="!"
          size="small"
          color="error"
          sx={{ height: 14, minWidth: 14, fontSize: 9, px: 0, flexShrink: 0 }}
        />
      )}

      {onDisconnect && (
        <Tooltip title="Disconnect">
          <IconButton
            size="small"
            className="chip-disconnect"
            onClick={onDisconnect}
            sx={{ opacity: 0, p: 0.25, flexShrink: 0, transition: 'opacity 0.15s' }}
          >
            <PowerSettingsNewIcon sx={{ fontSize: 11 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
};

type FolderChipProps = { group: ConnectionGroup };

const FolderChip: React.FC<FolderChipProps> = ({ group }) => (
  <Box
    sx={{
      ...chipSx,
      cursor: 'default',
      opacity: 0.65,
      '&:hover': { ...chipSx['&:hover'], opacity: 0.65 },
      '&:hover .chip-disconnect': {},
    }}
  >
    <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', pl: 0.25, color: 'var(--ov-fg-faint)' }}>
      <LuFolder size={13} />
    </Box>
    <Box component="span" sx={chipNameSx}>
      {group.name}
    </Box>
    <Box
      component="span"
      sx={{ fontSize: '0.65rem', color: 'var(--ov-fg-faint)', flexShrink: 0 }}
    >
      {group.connectionIds.length}
    </Box>
  </Box>
);

// ── Main component ────────────────────────────────────────────────────────────

const KubernetesHomepageCard: React.FC<HomepageCardProps> = ({ config }) => {
  const maxItems = config.maxItems ?? 5;
  const { sections } = config;

  const { connections } = useConnections({ plugin: PLUGIN_ID });
  const { entries: allStatusEntries, disconnect } = useConnectionStatus();
  const { favorites, recentConnections, customGroups, connectionOverrides, isLoading } =
    useClusterPreferences(PLUGIN_ID);

  const allConnections = connections.data ?? [];

  const connMap = React.useMemo(
    () => Object.fromEntries(allConnections.map((c) => [c.id, c])),
    [allConnections],
  );

  const connectedIdSet = React.useMemo(
    () => new Set(allStatusEntries.filter((e) => e.pluginID === PLUGIN_ID).map((e) => e.connectionID)),
    [allStatusEntries],
  );

  // All started entries for this plugin, sorted by name
  const connectedEntries = React.useMemo(
    () =>
      allStatusEntries
        .filter((e) => e.pluginID === PLUGIN_ID)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allStatusEntries],
  );

  const handleOpen = async (connectionId: string) => {
    await ResourceClient.StartConnection(PLUGIN_ID, connectionId).catch(() => {
      // ignore — connection may already be active, navigate anyway
    });
    window.location.hash = `/_plugin/${PLUGIN_ID}/cluster/${encodeURIComponent(connectionId)}/resources`;
  };

  const handleDisconnect = async (connectionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await disconnect(PLUGIN_ID, connectionId);
  };

  if (isLoading || connections.isLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  const recentSorted = Object.entries(recentConnections)
    .sort(([, a], [, b]) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
    .slice(0, maxItems);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Connected */}
      {sections.includes('connected') && (
        <Box>
          <SectionHeader title="Connected" />
          {connectedEntries.length === 0 ? (
            <EmptySectionNote message="No clusters connected" />
          ) : (
            <Box sx={chipGridSx}>
              {connectedEntries.slice(0, maxItems).map((entry) => (
                <ClusterChip
                  key={entry.connectionID}
                  id={entry.connectionID}
                  conn={connMap[entry.connectionID]}
                  override={connectionOverrides[entry.connectionID]}
                  isConnected
                  isSyncing={entry.isSyncing}
                  hasErrors={entry.hasErrors}
                  onClick={() => void handleOpen(entry.connectionID)}
                  onDisconnect={(e) => void handleDisconnect(entry.connectionID, e)}
                />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* Recent */}
      {sections.includes('recent') && (
        <Box>
          <SectionHeader title="Recent" />
          {recentSorted.length === 0 ? (
            <EmptySectionNote message="No recently accessed clusters" />
          ) : (
            <Box sx={chipGridSx}>
              {recentSorted.map(([id]) => (
                <ClusterChip
                  key={id}
                  id={id}
                  conn={connMap[id]}
                  override={connectionOverrides[id]}
                  isConnected={connectedIdSet.has(id)}
                  onClick={() => void handleOpen(id)}
                />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* Favorites */}
      {sections.includes('favorites') && (
        <Box>
          <SectionHeader title="Favorites" />
          {favorites.length === 0 ? (
            <EmptySectionNote message="No favorited clusters" />
          ) : (
            <Box sx={chipGridSx}>
              {favorites.slice(0, maxItems).map((id) => (
                <ClusterChip
                  key={id}
                  id={id}
                  conn={connMap[id]}
                  override={connectionOverrides[id]}
                  isConnected={connectedIdSet.has(id)}
                  onClick={() => void handleOpen(id)}
                />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* Folders */}
      {sections.includes('folders') && (
        <Box>
          <SectionHeader title="Folders" />
          {customGroups.length === 0 ? (
            <EmptySectionNote message="No folders created" />
          ) : (
            <Box sx={chipGridSx}>
              {customGroups.slice(0, maxItems).map((group) => (
                <FolderChip key={group.id} group={group} />
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

KubernetesHomepageCard.displayName = 'KubernetesHomepageCard';

export default KubernetesHomepageCard;
