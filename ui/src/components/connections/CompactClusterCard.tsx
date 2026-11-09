import { Card, StatusDot, Text } from '@omniviewdev/base-ui';
import React from 'react';

import type { EnrichedConnection } from '../../types/clusters';

import { clusterCardFacts, connectionLabel } from './clusterCardFacts';
import styles from './ClusterCards.module.css';
import ClusterCardTitle from './ClusterCardTitle';
import FavoriteButton from './FavoriteButton';

type Props = {
  enriched: EnrichedConnection;
  subtitle?: string;
  showFavorite?: boolean;
  selected?: boolean;
  onToggleFavorite?: () => void;
  onClick: () => void;
};

/**
 * Friendly name over one supporting line: the caller's subtitle or the sourced region.
 * Only an active connection is called out; exact identity and sources stay in the tooltip.
 */
const CompactClusterCard: React.FC<Props> = ({
  enriched,
  subtitle,
  showFavorite,
  selected,
  onToggleFavorite,
  onClick,
}) => {
  const { isConnected } = enriched;
  const facts = clusterCardFacts(enriched);
  const detail = subtitle || facts.region?.value || '';

  return (
    <Card interactive selected={selected} size="sm" className={`${styles.card} ${styles.compact}`}>
      <Card.Header className={`${styles.header} ${styles.headerCompact}`}>
        <ClusterCardTitle
          enriched={enriched}
          selected={selected}
          details={`${facts.identity}\n${facts.provenance}\n${connectionLabel(isConnected)}`}
          onClick={onClick}
        />
        <Text size="xs" tone="muted" truncate className={styles.detail}>
          {detail}
        </Text>
        {isConnected && (
          <StatusDot
            className={styles.compactStatus}
            size="sm"
            status="success"
            label={connectionLabel(isConnected)}
          />
        )}
        {showFavorite && onToggleFavorite && (
          <Card.Action placement="inline" className={styles.actions}>
            <FavoriteButton isFavorite={enriched.isFavorite} onToggle={onToggleFavorite} />
          </Card.Action>
        )}
      </Card.Header>
    </Card>
  );
};

export default CompactClusterCard;
