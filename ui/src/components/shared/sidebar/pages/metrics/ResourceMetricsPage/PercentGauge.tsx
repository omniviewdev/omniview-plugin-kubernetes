import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';

import { gaugeWrapperSx, gaugeHeaderSx, gaugeLabelSx, gaugeValueSx, gaugeBarSx } from './constants';

interface PercentGaugeProps {
  label: string;
  value: number;
}

const PercentGauge: React.FC<PercentGaugeProps> = ({ label, value }) => {
  const color = value >= 90 ? 'error' : value >= 70 ? 'warning' : 'primary';
  return (
    <Box sx={gaugeWrapperSx}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={gaugeHeaderSx}>
        <Text size="xs" sx={gaugeLabelSx}>
          {label}
        </Text>
        <Text size="xs" weight="semibold" sx={gaugeValueSx}>
          {value.toFixed(1)}%
        </Text>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.min(value, 100)}
        color={color}
        sx={gaugeBarSx}
      />
    </Box>
  );
};

export default PercentGauge;
