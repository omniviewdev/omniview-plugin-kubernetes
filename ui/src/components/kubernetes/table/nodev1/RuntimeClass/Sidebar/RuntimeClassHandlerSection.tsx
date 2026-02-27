import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { RuntimeClass } from 'kubernetes-types/node/v1';
import React from 'react';

const infoEntryGridSx = { minHeight: 22, alignItems: 'center' } as const;

const infoEntryLabelSx = { color: 'neutral.300' } as const;

const infoEntryValueSx = { fontWeight: 600, fontSize: 12 } as const;

const sectionBorderSx = { borderRadius: 1, border: '1px solid', borderColor: 'divider' } as const;

const sectionHeaderSx = { py: 0.5, px: 1 } as const;

const overheadBodySx = { py: 0.5, px: 1, bgcolor: 'background.level1' } as const;

interface Props {
  data: RuntimeClass;
}

const InfoEntry: React.FC<{ label: string; value?: string }> = ({ label, value }) => {
  if (!value) return null;
  return (
    <Grid container spacing={0} sx={infoEntryGridSx}>
      <Grid size={4}>
        <Text sx={infoEntryLabelSx} size="xs">
          {label}
        </Text>
      </Grid>
      <Grid size={8}>
        <Text sx={infoEntryValueSx} size="xs" noWrap>
          {value}
        </Text>
      </Grid>
    </Grid>
  );
};

const RuntimeClassHandlerSection: React.FC<Props> = ({ data }) => {
  const overhead = data.overhead?.podFixed;

  return (
    <Box sx={sectionBorderSx}>
      <Box sx={sectionHeaderSx}>
        <Stack direction="row" gap={0.75} alignItems="center">
          <Text weight="semibold" size="sm">
            Runtime
          </Text>
          <Chip size="sm" variant="outlined">
            {data.handler ?? '—'}
          </Chip>
        </Stack>
      </Box>
      {overhead && Object.keys(overhead).length > 0 && (
        <>
          <Divider />
          <Box sx={overheadBodySx}>
            <InfoEntry label="CPU Overhead" value={overhead.cpu} />
            <InfoEntry label="Memory Overhead" value={overhead.memory} />
          </Box>
        </>
      )}
    </Box>
  );
};

export default RuntimeClassHandlerSection;
