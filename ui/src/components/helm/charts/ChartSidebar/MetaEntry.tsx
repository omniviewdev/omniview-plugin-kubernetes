import React from 'react';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

const metaLabelSx = { color: 'neutral.400', flexShrink: 0 } as const;

const metaValueSx = { fontWeight: 400, color: 'neutral.100', textAlign: 'right' } as const;

const MetaEntry: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <Stack direction="row" justifyContent="space-between" alignItems="center">
    <Text sx={metaLabelSx} size="sm">
      {label}
    </Text>
    <Text
      sx={metaValueSx}
      weight="semibold"
      size="sm"
    >
      {value}
    </Text>
  </Stack>
);

MetaEntry.displayName = 'MetaEntry';
export default MetaEntry;
