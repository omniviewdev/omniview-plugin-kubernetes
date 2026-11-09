import { Card, Chip, StatusDot, Text } from '@omniviewdev/base-ui';
import React from 'react';

import type { EnrichedConnection, ConnectionGroup } from '../../types/clusters';

import { clusterCardFacts, connectionLabel, localityText } from './clusterCardFacts';
import styles from './ClusterCards.module.css';
import ClusterCardTitle from './ClusterCardTitle';
import { ClusterDragHandle } from './ClusterOrganization';
import ConnectionContextMenu from './ConnectionContextMenu';
import FavoriteButton from './FavoriteButton';
import ProviderIcon from './ProviderIcon';

type Props = {
  enriched: EnrichedConnection;
  customGroups: ConnectionGroup[];
  /** Current keyboard-navigation result, not connection or workload health. */
  selected?: boolean;
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

/**
 * Provider and independent actions, the friendly name, one muted locality line, then the
 * environment and connection state. Exact identity, sources and freshness stay available from the
 * primary action's tooltip and description and from the Preview action.
 */
const ConnectionCard: React.FC<Props> = ({
  enriched,
  customGroups,
  selected,
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
  const { connection, provider, isFavorite, isConnected, displayName } = enriched;
  const facts = clusterCardFacts(enriched);
  const { environment } = facts;
  // Emphasis follows the sourced environment fact only; cluster names never decide it.
  const production = /^(?:prod|production|prd)$/i.test(environment?.value.trim() ?? '');

  return (
    <Card interactive selected={selected} size="sm" className={styles.card}>
      <Card.Header className={`${styles.header} ${styles.headerFull}`}>
        <div className={styles.provider}>
          <span className={styles.providerIcon} aria-hidden="true">
            <ProviderIcon provider={provider} size={16} />
          </span>
          <Text size="xs" tone="muted" truncate>
            {facts.providerLabel}
          </Text>
        </div>
        <ClusterCardTitle
          enriched={enriched}
          selected={selected}
          details={`${facts.identity}\n${facts.provenance}`}
          onClick={onClick}
        />
        <Text size="xs" tone="muted" truncate className={styles.detail}>
          {localityText(facts)}
        </Text>
        <Card.Action placement="inline" className={styles.actions}>
          <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
          <ClusterDragHandle connectionId={connection.id} />
          <ConnectionContextMenu
            enriched={enriched}
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
        </Card.Action>
      </Card.Header>
      <Card.Body className={styles.footer}>
        {environment ? (
          <Chip
            size="sm"
            variant="outline"
            color={production ? 'warning' : 'neutral'}
            className={styles.environment}
          >
            {environment.value}
          </Chip>
        ) : (
          <Chip size="sm" variant="outline" color="neutral" className={styles.environment}>
            Unknown environment
          </Chip>
        )}
        <StatusDot
          className={styles.status}
          size="sm"
          status={isConnected ? 'success' : 'neutral'}
          variant={isConnected ? 'solid' : 'outline'}
          label={connectionLabel(isConnected)}
        />
      </Card.Body>
    </Card>
  );
};

export default ConnectionCard;
