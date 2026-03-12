import React from 'react';
import Box from '@mui/material/Box';
import { Card, Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { TabPanel } from '@omniviewdev/ui/navigation';
import { Text } from '@omniviewdev/ui/typography';
import { LuExternalLink } from 'react-icons/lu';

import type { HelmChart } from './types';

interface Props {
  activeTab: string;
  maintainers: NonNullable<HelmChart['maintainers']>;
  keywords: string[];
  dependencies: NonNullable<HelmChart['dependencies']>;
}

const sectionCardSx = { p: 1.25, borderRadius: 'sm' } as const;

const sectionHeadingSx = { mb: 0.5 } as const;

const maintainerTextSx = { color: 'neutral.300' } as const;

const maintainerLinkSx = { ml: 0.5, color: 'primary.300', textDecoration: 'none' } as const;

const depRepoSx = { color: 'neutral.500' } as const;

const ChartOverviewTab: React.FC<Props> = ({
  activeTab,
  maintainers,
  keywords,
  dependencies,
}) => (
  <TabPanel value="overview" activeValue={activeTab}>
    <Stack direction="column" spacing={1.5}>
      {/* Maintainers */}
      {maintainers.length > 0 && (
        <Card sx={sectionCardSx} emphasis="outline">
          <Text weight="semibold" size="sm" sx={sectionHeadingSx}>
            Maintainers
          </Text>
          <Stack direction="column" spacing={0.5}>
            {maintainers.map((m) => (
              <Text key={`${m.name}-${m.email ?? ''}-${m.url ?? ''}`} size="xs" sx={maintainerTextSx}>
                {m.name}
                {m.email ? ` <${m.email}>` : ''}
                {m.url && (
                  <Box
                    component="a"
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={maintainerLinkSx}
                  >
                    <LuExternalLink size={10} />
                  </Box>
                )}
              </Text>
            ))}
          </Stack>
        </Card>
      )}

      {/* Keywords */}
      {keywords.length > 0 && (
        <Card sx={sectionCardSx} emphasis="outline">
          <Text weight="semibold" size="sm" sx={sectionHeadingSx}>
            Keywords
          </Text>
          <Stack direction="row" spacing={0.5} flexWrap="wrap">
            {keywords.map((kw) => (
              <Chip key={kw} size="sm" emphasis="soft" color="neutral" label={kw} />
            ))}
          </Stack>
        </Card>
      )}

      {/* Dependencies */}
      {dependencies.length > 0 && (
        <Card sx={sectionCardSx} emphasis="outline">
          <Text weight="semibold" size="sm" sx={sectionHeadingSx}>
            Dependencies
          </Text>
          <Stack direction="column" spacing={0.5}>
            {dependencies.map((dep) => (
              <Stack key={dep.name} direction="row" spacing={1} alignItems="center">
                <Text size="xs" weight="semibold">
                  {dep.name}
                </Text>
                {dep.version && (
                  <Chip size="sm" emphasis="soft" color="neutral" label={dep.version} />
                )}
                {dep.repository && (
                  <Text size="xs" sx={depRepoSx}>
                    {dep.repository}
                  </Text>
                )}
              </Stack>
            ))}
          </Stack>
        </Card>
      )}
    </Stack>
  </TabPanel>
);

ChartOverviewTab.displayName = 'ChartOverviewTab';
export default ChartOverviewTab;
