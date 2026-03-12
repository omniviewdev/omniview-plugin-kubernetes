import Box from '@mui/material/Box';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';

import { tileSx, tileLabelSx, tileValueSx } from './constants';

interface MetricTileProps {
  label: string;
  value: string;
}

const MetricTile: React.FC<MetricTileProps> = ({ label, value }) => (
  <Box sx={tileSx}>
    <Text size="xs" sx={tileLabelSx}>
      {label}
    </Text>
    <Text size="sm" weight="semibold" sx={tileValueSx}>
      {value}
    </Text>
  </Box>
);

export default MetricTile;
