import { Avatar, Card, Caption, StatusDot, Text } from '@omniviewdev/base-ui';
import React from 'react';

import type { EnrichedConnection } from '../../types/clusters';
import NamedAvatar from '../shared/NamedAvatar';
import SimpleTooltip from '../shared/SimpleTooltip';
import { getRegionFlag } from '../../utils/regions';
import { connectionLabel, type ClusterCardFacts } from './clusterCardFacts';
import ProviderIcon from './ProviderIcon';

import styles from './ClusterCards.module.css';

type Props = {
  enriched: EnrichedConnection;
  /** Current keyboard-navigation result, not connection or workload health. */
  selected?: boolean;
  facts: ClusterCardFacts;
  onClick: () => void;
};

/**
 * The single-line friendly name and the card's primary open action. It is the only focusable
 * element inside the title and stretches over the card; independent actions stay in sibling
 * Card.Action slots. A custom cluster icon is shown only when the user chose one; provider
 * identity stays in the owning card's provider row.
 */
const ClusterCardTitle: React.FC<Props> = ({ enriched, selected, facts, onClick }) => {
  const { connection, displayName, avatar, avatarColor, provider, isConnected } = enriched;
  const summary = [
    ['Region', facts.region],
    [facts.accountLabel, facts.account],
    ['Environment', facts.environment],
  ] as const;
  return (
    <Card.Title className={styles.title}>
      <SimpleTooltip
        size="md"
        content={
          <div className={styles.tooltip}>
            <div className={styles.tooltipHeader}>
              <span className={styles.tooltipProvider}>
                <ProviderIcon provider={provider} size={14} />
                <Caption size="sm" tone="muted">{facts.providerLabel}</Caption>
              </span>
              <StatusDot size="sm" status={isConnected ? 'success' : 'neutral'}
                variant={isConnected ? 'solid' : 'outline'} label={connectionLabel(isConnected)} />
            </div>
            <Text size="sm" weight="semibold" className={styles.tooltipName}>{displayName}</Text>
            {summary.some(([, fact]) => fact) && (
              <dl className={styles.tooltipFacts}>
                {summary.map(([label, fact]) => fact && (
                  <React.Fragment key={label}>
                    <dt><Caption size="sm" tone="muted">{label}</Caption></dt>
                    <dd>
                      {label === 'Region' && <span aria-hidden="true">{getRegionFlag(fact.value)} </span>}
                      {fact.value}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            )}
          </div>
        }
      >
        <Card.ActionArea
          as="button"
          stretched
          onClick={onClick}
          data-cluster-open={connection.id}
          aria-label={`Open ${displayName}`}
          aria-description={[facts.identity, connectionLabel(isConnected)].filter(Boolean).join('\n')}
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
            <span className={styles.name}>{displayName}</span>
          </span>
        </Card.ActionArea>
      </SimpleTooltip>
    </Card.Title>
  );
};

export default ClusterCardTitle;
