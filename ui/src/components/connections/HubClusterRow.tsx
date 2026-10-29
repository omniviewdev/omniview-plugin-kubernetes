import { Avatar } from '@omniviewdev/base-ui';
import React from 'react';

import type { EnrichedConnection } from '../../types/clusters';
import NamedAvatar from '../shared/NamedAvatar';

import styles from './Connections.module.css';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import FavoriteButton from './FavoriteButton';
import ProviderIcon from './ProviderIcon';

const avatarStyle: React.CSSProperties = { borderRadius: 6, backgroundColor: 'transparent' };

const contentStyle: React.CSSProperties = { flex: 1, minWidth: 0 };

const nameRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
};

const providerIconStyle: React.CSSProperties = { flexShrink: 0, display: 'flex' };

type Props = {
  enriched: EnrichedConnection;
  subtitle?: string;
  showFavorite?: boolean;
  onToggleFavorite?: () => void;
  onClick: () => void;
};

const HubClusterRow: React.FC<Props> = ({
  enriched,
  subtitle,
  showFavorite,
  onToggleFavorite,
  onClick,
}) => {
  const { provider, isConnected, displayName } = enriched;

  return (
    // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions
    <div onClick={onClick} className={styles.tile}>
      <ConnectionStatusBadge isConnected={isConnected}>
        {enriched.avatar ? (
          <Avatar size="sm" shape="rounded" src={enriched.avatar} style={avatarStyle} />
        ) : (
          <NamedAvatar value={displayName} color={enriched.avatarColor} />
        )}
      </ConnectionStatusBadge>

      <div style={contentStyle}>
        <div style={nameRowStyle}>
          <div style={providerIconStyle}>
            <ProviderIcon provider={provider} />
          </div>
          <span className={styles.tileName}>{displayName}</span>
        </div>
        {subtitle && <span className={styles.tileSubtitle}>{subtitle}</span>}
      </div>

      {showFavorite && onToggleFavorite && (
        <FavoriteButton isFavorite={enriched.isFavorite} onToggle={onToggleFavorite} />
      )}
    </div>
  );
};

export default HubClusterRow;
