import { IconButton, Spinner, Text } from '@omniviewdev/base-ui';
import { useConnections, useConnectionStatus, usePluginRouter } from '@omniviewdev/runtime';
import type { HomepageCardProps } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import { type types } from '@omniviewdev/runtime/models';
import React from 'react';
import { LuFolder, LuPower } from 'react-icons/lu';

import { PLUGIN_ID } from '@/pluginId';

import { useClusterPreferences } from '../../hooks/useClusterPreferences';
import type { ConnectionOverride, ConnectionGroup } from '../../types/clusters';
import ConnectionStatusBadge from '../connections/ConnectionStatusBadge';
import NamedAvatar from '../shared/NamedAvatar';
import SectionHeader from '../shared/SectionHeader';
import SimpleTooltip from '../shared/SimpleTooltip';

import ConnectedClusterCard from './ConnectedClusterCard';
import styles from './KubernetesHomepageCard.module.css';


// ── Shared styles ─────────────────────────────────────────────────────────────

const avatarImageStyle: React.CSSProperties = { width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' };
const emptyNoteStyle: React.CSSProperties = { paddingInline: 4, paddingBlock: 4 };
const smallSpinnerStyle: React.CSSProperties = { width: 9, height: 9, flexShrink: 0 };
const folderIconStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  paddingLeft: 2,
  color: 'var(--ov-color-fg-subtle)',
};
const folderCountStyle: React.CSSProperties = { fontSize: '0.65rem', color: 'var(--ov-color-fg-subtle)', flexShrink: 0 };
const loadingStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 };
const rootStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 0 };

// ── Sub-components ────────────────────────────────────────────────────────────

const EmptySectionNote: React.FC<{ message: string }> = ({ message }) => (
  <div style={emptyNoteStyle}>
    <Text size="xs" tone="subtle">
      {message}
    </Text>
  </div>
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
  stretch?: boolean;
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
  stretch,
}) => {
  const displayName = override?.displayName ?? conn?.name ?? id;
  const avatar = override?.avatar ?? conn?.avatar;
  const avatarColor = override?.avatarColor;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={stretch ? `${styles.Chip} ${styles.Stretch}` : styles.Chip}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <ConnectionStatusBadge isConnected={isConnected}>
        {avatar ? (
          <img src={avatar} alt="" style={avatarImageStyle} />
        ) : (
          <NamedAvatar value={displayName} color={avatarColor} />
        )}
      </ConnectionStatusBadge>

      <span className={styles.ChipName}>{displayName}</span>

      {isSyncing && <Spinner size="xs" color="neutral" style={smallSpinnerStyle} />}
      {!isSyncing && hasErrors && <span className={styles.ErrorBadge}>!</span>}

      {onDisconnect && (
        <SimpleTooltip content="Disconnect">
          <IconButton
            size="xs"
            variant="ghost"
            color="neutral"
            aria-label="Disconnect"
            className={styles.Disconnect}
            onClick={onDisconnect}
          >
            <LuPower size={11} />
          </IconButton>
        </SimpleTooltip>
      )}
    </div>
  );
};

type FolderChipProps = { group: ConnectionGroup };

const FolderChip: React.FC<FolderChipProps> = ({ group }) => (
  <div className={`${styles.Chip} ${styles.Folder}`}>
    <div style={folderIconStyle}>
      <LuFolder size={13} />
    </div>
    <span className={styles.ChipName}>{group.name}</span>
    <span style={folderCountStyle}>{group.connectionIds.length}</span>
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

const KubernetesHomepageCard: React.FC<HomepageCardProps> = ({ config }) => {
  const maxItems = config.maxItems ?? 5;
  const sections = Array.isArray(config.sections) ? config.sections : [];

  const { navigate } = usePluginRouter();
  const { connections } = useConnections({ plugin: PLUGIN_ID });
  const { entries: allStatusEntries, disconnect } = useConnectionStatus();
  const { favorites, recentConnections, customGroups, connectionOverrides, isLoading, recordAccess } =
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
    if (!connectedIdSet.has(connectionId)) {
      try {
        await ResourceClient.StartConnection(PLUGIN_ID, connectionId);
      } catch {
        return;
      }
    }
    await recordAccess(connectionId);
    navigate(`/cluster/${encodeURIComponent(connectionId)}/resources`);
  };

  const handleDisconnect = async (connectionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await disconnect(PLUGIN_ID, connectionId);
    } catch (err) {
      console.error(`Failed to disconnect ${connectionId}:`, err);
    }
  };

  if (isLoading || connections.isLoading) {
    return (
      <div style={loadingStyle}>
        <Spinner size="lg" />
      </div>
    );
  }

  const recentSorted = Object.entries(recentConnections)
    .sort(([, a], [, b]) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
    .slice(0, maxItems);

  return (
    <div style={rootStyle}>
      {/* Connected */}
      {sections.includes('connected') && (
        <div>
          <SectionHeader title="Connected" />
          {connectedEntries.length === 0 ? (
            <EmptySectionNote message="No clusters connected" />
          ) : (
            <div className={styles.ConnectedGrid}>
              {connectedEntries.slice(0, maxItems).map((entry) => (
                <ConnectedClusterCard
                  key={entry.connectionID}
                  connectionID={entry.connectionID}
                  conn={connMap[entry.connectionID]}
                  override={connectionOverrides[entry.connectionID]}
                  isSyncing={entry.isSyncing}
                  hasErrors={entry.hasErrors}
                  onClick={() => void handleOpen(entry.connectionID)}
                  onDisconnect={(e) => void handleDisconnect(entry.connectionID, e)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent */}
      {sections.includes('recent') && (
        <div>
          <SectionHeader title="Recent" />
          {recentSorted.length === 0 ? (
            <EmptySectionNote message="No recently accessed clusters" />
          ) : (
            <div className={styles.ChipGrid}>
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
            </div>
          )}
        </div>
      )}

      {/* Favorites */}
      {sections.includes('favorites') && (
        <div>
          <SectionHeader title="Favorites" />
          {favorites.length === 0 ? (
            <EmptySectionNote message="No favorited clusters" />
          ) : (
            <div className={styles.ChipGrid}>
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
            </div>
          )}
        </div>
      )}

      {/* Folders */}
      {sections.includes('folders') && (
        <div>
          <SectionHeader title="Folders" />
          {customGroups.length === 0 ? (
            <EmptySectionNote message="No folders created" />
          ) : (
            <div className={styles.ChipGrid}>
              {customGroups.slice(0, maxItems).map((group) => (
                <FolderChip key={group.id} group={group} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

KubernetesHomepageCard.displayName = 'KubernetesHomepageCard';

export default KubernetesHomepageCard;
