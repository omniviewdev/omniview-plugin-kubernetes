// @omniviewdev/ui
import Box from '@mui/material/Box';
import { Chip } from '@omniviewdev/ui';
import { Tooltip } from '@omniviewdev/ui/overlays';
import React from 'react';

// ---------------------------------------------------------------------------
// Static styles
// ---------------------------------------------------------------------------

const badgeDotSx = {
  borderRadius: 2,
  width: 12,
  height: 12,
  maxWidth: 12,
  maxHeight: 12,
  minWidth: 12,
  minHeight: 12,
} as const;

type Props = {
  values: string[];
  colorMap: Record<string, 'success' | 'warning' | 'danger' | 'primary' | 'neutral'>;
  align?: 'left' | 'right' | 'center' | 'justify';
  hoverMenu?: (value: string) => React.ReactNode;
  hoverMenuDelay?: number;
};

export const BadgesCell: React.FC<Props> = ({ align, values, colorMap, hoverMenu }) => {
  const getColor = (value: string) => colorMap[value] ?? 'neutral';

  const getAlignment = () => {
    if (align) {
      switch (align) {
        case 'left':
          return 'flex-start';
        case 'right':
          return 'flex-end';
        case 'center':
          return 'center';
        case 'justify':
          return 'space-between';
      }
    }
    return 'flex-start';
  };

  return (
    <Box display="flex" flex={1} justifyContent={getAlignment()} alignItems="center">
      {values.map((value) =>
        hoverMenu ? (
          <Tooltip key={value} content={hoverMenu(value)}>
            <Chip
              size="sm"
              emphasis="solid"
              color={getColor(value)}
              sx={badgeDotSx}
              label=""
            />
          </Tooltip>
        ) : (
          <Chip
            key={value}
            size="sm"
            emphasis="solid"
            color={getColor(value)}
            sx={badgeDotSx}
            label=""
          />
        ),
      )}
    </Box>
  );
};

export default BadgesCell;
