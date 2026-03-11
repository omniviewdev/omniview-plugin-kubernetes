import Grid from '@mui/material/Grid';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';

import SidebarSection from './SidebarSection';

const cellSx = { alignItems: 'center' } as const;

const headerTextSx = { color: 'neutral.400' } as const;

interface Props {
  hard?: Record<string, string>;
  used?: Record<string, string>;
}

const QuotaUsageTable: React.FC<Props> = ({ hard, used }) => {
  if (!hard || Object.keys(hard).length === 0) return null;

  const resources = Object.keys(hard);

  return (
    <SidebarSection title="Resource Quota">
      <Grid container spacing={0.25}>
        <Grid size={4} sx={cellSx}>
          <Text size="xs" weight="semibold" sx={headerTextSx}>
            Resource
          </Text>
        </Grid>
        <Grid size={4} sx={cellSx}>
          <Text size="xs" weight="semibold" sx={headerTextSx}>
            Used
          </Text>
        </Grid>
        <Grid size={4} sx={cellSx}>
          <Text size="xs" weight="semibold" sx={headerTextSx}>
            Hard
          </Text>
        </Grid>
        {resources.map((resource) => (
          <React.Fragment key={resource}>
            <Grid size={4} sx={cellSx}>
              <Text size="xs" weight="semibold">
                {resource}
              </Text>
            </Grid>
            <Grid size={4} sx={cellSx}>
              <Text size="xs">{used?.[resource] ?? '-'}</Text>
            </Grid>
            <Grid size={4} sx={cellSx}>
              <Text size="xs">{hard[resource]}</Text>
            </Grid>
          </React.Fragment>
        ))}
      </Grid>
    </SidebarSection>
  );
};

export default QuotaUsageTable;
