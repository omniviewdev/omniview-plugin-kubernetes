import Grid from '@mui/material/Grid';
import { ClipboardText } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';

import Icon from '../../../../shared/Icon';

import { fontSize13Sx, infoRowLabelCellSx, infoRowSx, infoRowValueCellSx } from './styles';

const InfoRow: React.FC<{ icon: string; label: string; value: string }> = ({
  icon,
  label,
  value,
}) => (
  <Grid container spacing={0.5} sx={infoRowSx}>
    <Grid size={3} sx={infoRowLabelCellSx}>
      <Stack direction="row" gap={0.75} alignItems="center">
        <Icon name={icon} size={14} />
        <Text sx={fontSize13Sx}>{label}</Text>
      </Stack>
    </Grid>
    <Grid size={9} sx={infoRowValueCellSx}>
      <ClipboardText
        value={value}
        truncate={false}
        sx={{
          color: 'neutral.200',
          wordBreak: 'break-all',
          lineHeight: 1.6,
          fontSize: 13,
          py: 0.25,
        }}
      />
    </Grid>
  </Grid>
);

export default InfoRow;
