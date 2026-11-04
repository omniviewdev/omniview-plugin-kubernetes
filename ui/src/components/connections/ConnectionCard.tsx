import { Avatar, Card } from '@omniviewdev/base-ui';
import React from 'react';

import type { EnrichedConnection, ConnectionGroup } from '../../types/clusters';
import { getClusterDisplayFacts } from '../../utils/clusterSearch';
import { getProviderLabel } from '../../utils/providers';
import NamedAvatar from '../shared/NamedAvatar';

import styles from './ClusterCards.module.css';
import ConnectionContextMenu from './ConnectionContextMenu';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import FavoriteButton from './FavoriteButton';
import ProviderIcon from './ProviderIcon';
import { ClusterDragHandle } from './ClusterOrganization';

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
  const { connection, provider, isFavorite, isConnected, displayName, displayDescription } =
    enriched;
  const facts = getClusterDisplayFacts(enriched);
  const account = facts.account ?? facts.project;
  const accountLabel = facts.account ? 'Account' : facts.project ? 'Project' : 'Account';
  const identity = [
    `Context: ${connection.name || connection.id}`,
    `Connection ID: ${connection.id}`,
    displayDescription,
    enriched.tags.length ? `Tags: ${enriched.tags.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const environment = facts.environment;
  const region = facts.region;
  const environmentText = `Env${environment?.hint ? ' hint' : ''}: ${environment?.value ?? 'unknown'}`;
  const regionText = `Region${region?.hint ? ' hint' : ''}: ${region?.value ?? 'unknown'}`;
  const accountText = `${accountLabel}${account?.hint ? ' hint' : ''}: ${account?.value ?? 'unknown'}`;
  const factDetails = [
    environment
      ? `${environmentText} · ${environment.provenance}: ${environment.key}`
      : 'Environment unknown',
    region ? `${regionText} · ${region.provenance}: ${region.key}` : 'Region unknown',
    account ? `${accountText} · ${account.provenance}: ${account.key}` : 'Account unknown',
    `Configured provider hint: ${getProviderLabel(provider)}`,
    `Metadata ${facts.metadataState}; not a workload health assessment`,
  ].join('\n');

  return (
    <Card interactive selected={selected} size="sm" className={styles.card}>
      <Card.Header className={styles.header}>
        <span className={styles.avatar} aria-hidden="true">
          <ConnectionStatusBadge isConnected={isConnected}>
            {enriched.avatar ? (
              <Avatar
                size="sm"
                shape="rounded"
                src={enriched.avatar}
                className={styles.customAvatar}
              />
            ) : (
              <NamedAvatar value={displayName} color={enriched.avatarColor} />
            )}
          </ConnectionStatusBadge>
        </span>
        <div className={styles.identity}>
          <Card.Title className={styles.title}>
            <Card.ActionArea
              as="button"
              stretched
              onClick={onClick}
              data-cluster-open={connection.id}
              aria-label={`Open ${displayName}`}
              aria-description={`${identity}\n${factDetails}`}
              aria-current={selected ? 'true' : undefined}
              title={`${displayName}\n${identity}\n${factDetails}`}
            >
              <span className={styles.truncate}>{displayName}</span>
            </Card.ActionArea>
          </Card.Title>
          <span
            className={styles.subtitle}
            title={displayDescription || connection.name || connection.id}
          >
            {displayDescription || connection.name || connection.id}
          </span>
        </div>
        <Card.Action className={styles.actions}>
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
      <div className={styles.details}>
        <div className={styles.factRow}>
          <span
            className={styles.provider}
            title={`Configured provider hint: ${getProviderLabel(provider)}`}
          >
            <span aria-hidden="true">
              <ProviderIcon provider={provider} size={14} />
            </span>
            <span className={styles.truncate}>{getProviderLabel(provider)} hint</span>
          </span>
          <span
            className={styles.fact}
            title={
              environment
                ? `${environmentText} · ${environment.provenance}: ${environment.key}`
                : 'Environment unknown'
            }
          >
            {environmentText}
          </span>
        </div>
        <div className={styles.factRow}>
          <span
            className={styles.fact}
            title={
              region ? `${regionText} · ${region.provenance}: ${region.key}` : 'Region unknown'
            }
          >
            {regionText}
          </span>
          <span
            className={styles.fact}
            title={
              account ? `${accountText} · ${account.provenance}: ${account.key}` : 'Account unknown'
            }
          >
            {accountText}
          </span>
        </div>
        <div className={styles.factRow}>
          <span className={styles.status}>{isConnected ? 'Connected' : 'Disconnected'}</span>
          <span
            className={styles.fact}
            title={`Metadata ${facts.metadataState}; not a workload health assessment`}
          >
            Metadata {facts.metadataState}
          </span>
        </div>
      </div>
    </Card>
  );
};

export default ConnectionCard;
