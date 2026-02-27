// material ui
import Box from '@mui/material/Box';
import { Chip } from '@omniviewdev/ui';
import { Tooltip } from '@omniviewdev/ui/overlays';
import React from 'react';

const badgeSx = {
  borderRadius: 2,
  width: 12,
  height: 12,
  maxWidth: 12,
  maxHeight: 12,
  minWidth: 12,
  minHeight: 12,
} as const;

const badgeWithTypoSx = {
  borderRadius: 2,
  width: 12,
  height: 12,
  wmaxWidth: 12,
  maxHeight: 12,
  minWidth: 12,
  minHeight: 12,
} as const;

type Props = {
  /** The values to use for calculating the badge colors */
  values: string[];
  /** Specify mapping of values to badges that will change with the input */
  colorMap: Record<string, 'success' | 'warning' | 'danger' | 'primary' | 'neutral'>;
  /** The horizontal alignment of the text. Default is 'left' */
  align?: 'left' | 'right' | 'center' | 'justify';
  /** The contents to put in the menu on hover, if any */
  hoverMenu?: React.ReactNode;
  /** The time to wait before showing the hover menu, in ms. Defaults to 200ms */
  hoverMenuDelay?: number;
};

/** Render a list of badges for the generic resource table. */
export const BadgesRow: React.FC<Props> = ({
  align,
  values,
  colorMap,
  hoverMenu,
  hoverMenuDelay,
}) => {
  const getColor = (value: string) => colorMap[value] || 'neutral';

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

  const hoverMenuDelayValue = hoverMenuDelay || 200;

  return (
    <Box display="flex" flex={1} justifyContent={getAlignment()} alignItems="center">
      {values.map((value) =>
        hoverMenu ? (
          <Tooltip key={value} content={hoverMenu} delay={hoverMenuDelayValue}>
            <Chip
              size="sm"
              emphasis="solid"
              color={getColor(value)}
              sx={badgeSx}
            />
          </Tooltip>
        ) : (
          <Chip
            key={value}
            size="sm"
            emphasis="solid"
            color={getColor(value)}
            sx={badgeWithTypoSx}
          />
        ),
      )}
    </Box>
  );
};

export default BadgesRow;
