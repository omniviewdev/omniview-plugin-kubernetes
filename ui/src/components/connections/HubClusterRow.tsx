import Box from '@mui/material/Box';
import { Avatar } from '@omniviewdev/ui';
import React from 'react';

import type { EnrichedConnection } from '../../types/clusters';
import NamedAvatar from '../shared/NamedAvatar';

import ConnectionStatusBadge from './ConnectionStatusBadge';
import FavoriteButton from './FavoriteButton';
import ProviderIcon from './ProviderIcon';

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  px: 1.25,
  py: 0.75,
  cursor: 'pointer',
  borderRadius: 'var(--ov-radius-md, 6px)',
  border: '1px solid var(--ov-border-default, rgba(255,255,255,0.08))',
  bgcolor: 'var(--ov-bg-surface, rgba(255,255,255,0.03))',
  transition: 'border-color 0.15s, background-color 0.15s, box-shadow 0.15s',
  '&:hover': {
    borderColor: 'var(--ov-border-emphasis, rgba(255,255,255,0.15))',
    bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))',
    boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
  },
} as const;

const avatarSx = { borderRadius: '6px', bgcolor: 'transparent' } as const;

const contentSx = { flex: 1, minWidth: 0 } as const;

const nameRowSx = { display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 } as const;

const providerIconSx = { flexShrink: 0, display: 'flex' } as const;

const nameSx = {
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--ov-fg-base)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

const subtitleSx = {
  display: 'block',
  fontSize: '0.7rem',
  color: 'var(--ov-fg-faint)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

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
    <Box
      onClick={onClick}
      sx={rowSx}
    >
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

      <Box sx={contentSx}>
        <Box sx={nameRowSx}>
          <Box sx={providerIconSx}>
            <ProviderIcon provider={provider} />
          </Box>
          <Box
            component="span"
            sx={nameSx}
          >
            {displayName}
          </Box>
        </Box>
        {subtitle && (
          <Box
            component="span"
            sx={subtitleSx}
          >
            {subtitle}
          </Box>
        )}
      </Box>

      {showFavorite && onToggleFavorite && (
        <FavoriteButton isFavorite={enriched.isFavorite} onToggle={onToggleFavorite} />
      )}
    </Box>
  );
};

export default HubClusterRow;
