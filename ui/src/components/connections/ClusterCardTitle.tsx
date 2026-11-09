import { Avatar, Card, Text } from '@omniviewdev/base-ui';
import React from 'react';

import type { EnrichedConnection } from '../../types/clusters';
import NamedAvatar from '../shared/NamedAvatar';
import SimpleTooltip from '../shared/SimpleTooltip';

import styles from './ClusterCards.module.css';

type Props = {
  enriched: EnrichedConnection;
  /** Current keyboard-navigation result, not connection or workload health. */
  selected?: boolean;
  /** Exact identity and sourcing behind the card face, for hover and assistive technology. */
  details: string;
  onClick: () => void;
};

/**
 * The single-line friendly name and the card's primary open action. It is the only focusable
 * element inside the title and stretches over the card; independent actions stay in sibling
 * Card.Action slots. A custom cluster icon is shown only when the user chose one; provider
 * identity stays in the owning card's provider row.
 */
const ClusterCardTitle: React.FC<Props> = ({ enriched, selected, details, onClick }) => {
  const { connection, displayName, avatar, avatarColor } = enriched;
  return (
    <Card.Title className={styles.title}>
      <SimpleTooltip
        content={<span className={styles.tooltipText}>{`${displayName}\n${details}`}</span>}
      >
        <Card.ActionArea
          as="button"
          stretched
          onClick={onClick}
          data-cluster-open={connection.id}
          aria-label={`Open ${displayName}`}
          aria-description={details}
          aria-current={selected ? 'true' : undefined}
        >
          <span className={styles.nameRow}>
            {avatar || avatarColor ? (
              <span className={styles.avatar} aria-hidden="true">
                {avatar ? (
                  <Avatar
                    size="sm"
                    shape="rounded"
                    src={avatar}
                    alt=""
                    className={styles.customAvatar}
                  />
                ) : (
                  <NamedAvatar value={displayName} color={avatarColor} />
                )}
              </span>
            ) : null}
            <Text as="span" size="md" weight="semibold" truncate>
              {displayName}
            </Text>
          </span>
        </Card.ActionArea>
      </SimpleTooltip>
    </Card.Title>
  );
};

export default ClusterCardTitle;
