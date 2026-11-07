import { Avatar, Card } from '@omniviewdev/base-ui';
import React from 'react';

import type { EnrichedConnection } from '../../types/clusters';
import { getProviderLabel } from '../../utils/providers';
import NamedAvatar from '../shared/NamedAvatar';

import styles from './ClusterCards.module.css';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import FavoriteButton from './FavoriteButton';
import ProviderIcon from './ProviderIcon';

type Props = {
  enriched: EnrichedConnection;
  subtitle?: string;
  showFavorite?: boolean;
  selected?: boolean;
  onToggleFavorite?: () => void;
  onClick: () => void;
};

const CompactClusterCard: React.FC<Props> = ({
  enriched,
  subtitle,
  showFavorite,
  selected,
  onToggleFavorite,
  onClick,
}) => {
  const { connection, provider, isConnected, displayName } = enriched;
  const identity = [
    `Context: ${connection.name || connection.id}`,
    `Connection ID: ${connection.id}`,
    enriched.displayDescription,
    enriched.tags.length ? `Tags: ${enriched.tags.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const detail = subtitle || enriched.displayDescription || connection.name || connection.id;

  return (
    <Card interactive selected={selected} size="sm" className={`${styles.card} ${styles.compact}`}>
      <Card.Header className={styles.header}>
        <span className={styles.avatar} aria-hidden="true">
          <ConnectionStatusBadge isConnected={isConnected}>
            {enriched.avatar ? (
              <Avatar
                size="xs"
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
              aria-description={`${identity}\n${isConnected ? 'Connected' : 'Disconnected'}`}
              aria-current={selected ? 'true' : undefined}
              title={`${displayName}\n${identity}`}
            >
              <span className={styles.truncate}>{displayName}</span>
            </Card.ActionArea>
          </Card.Title>
          <span className={styles.subtitle} title={detail}>
            {detail}
          </span>
        </div>
        {showFavorite && onToggleFavorite && (
          <Card.Action className={styles.actions}>
            <FavoriteButton isFavorite={enriched.isFavorite} onToggle={onToggleFavorite} />
          </Card.Action>
        )}
      </Card.Header>
      <div className={styles.factRow}>
        <span
          className={styles.provider}
          title={`Configured provider hint: ${getProviderLabel(provider)}`}
        >
          <span aria-hidden="true">
            <ProviderIcon provider={provider} size={12} />
          </span>
          <span className={styles.truncate}>{getProviderLabel(provider)} hint</span>
        </span>
        <span className={styles.status}>{isConnected ? 'Connected' : 'Disconnected'}</span>
      </div>
    </Card>
  );
};

export default CompactClusterCard;
