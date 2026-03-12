import React from 'react';
import Box from '@mui/material/Box';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { TabPanel } from '@omniviewdev/ui/navigation';
import { Text } from '@omniviewdev/ui/typography';

import type { ChartVersion } from './types';
import { formatDate, relativeTime } from './utils';

interface Props {
  activeTab: string;
  versions: ChartVersion[];
  selectedVersion: string;
  onVersionChange: (version: string) => void;
  loading?: boolean;
}

const versionsListSx = {
  border: '1px solid',
  borderColor: 'neutral.800',
  borderRadius: 'sm',
  overflow: 'hidden',
} as const;

const appVersionSx = { color: 'neutral.500', minWidth: 80, flexShrink: 0 } as const;

const badgesStackSx = { flex: 1, minWidth: 0 } as const;

const dateTextSx = { color: 'neutral.600', flexShrink: 0 } as const;

const emptyTextSx = { color: 'neutral.400' } as const;

const ChartVersionsTab: React.FC<Props> = ({
  activeTab,
  versions,
  selectedVersion,
  onVersionChange,
  loading = false,
}) => (
  <TabPanel value="versions" activeValue={activeTab}>
    {versions.length > 0 ? (
      <Stack
        direction="column"
        spacing={0}
        sx={versionsListSx}
      >
        {versions.map((v, i) => {
          const isSelected = v.version === selectedVersion;
          return (
            <Stack
              key={v.version}
              direction="row"
              alignItems="center"
              role="button"
              tabIndex={0}
              onClick={() => onVersionChange(v.version)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onVersionChange(v.version);
                }
              }}
              sx={{
                px: 1.25,
                py: 0.625,
                cursor: 'pointer',
                borderBottom: i < versions.length - 1 ? '1px solid' : 'none',
                borderColor: 'neutral.800',
                bgcolor: isSelected
                  ? 'rgba(var(--mui-palette-primary-mainChannel) / 0.08)'
                  : 'transparent',
                '&:hover': {
                  bgcolor: isSelected
                    ? 'rgba(var(--mui-palette-primary-mainChannel) / 0.12)'
                    : 'action.hover',
                },
              }}
            >
              {/* Version */}
              <Text
                size="xs"
                weight={isSelected ? 'semibold' : undefined}
                sx={{
                  minWidth: 100,
                  color: isSelected ? 'primary.300' : 'neutral.100',
                }}
              >
                {v.version}
              </Text>

              {/* App version */}
              <Text size="xs" sx={appVersionSx}>
                {v.appVersion || '\u2014'}
              </Text>

              {/* Badges */}
              <Stack direction="row" spacing={0.5} sx={badgesStackSx}>
                {isSelected && (
                  <Chip size="sm" emphasis="soft" color="primary" label="Selected" />
                )}
                {v.deprecated && (
                  <Chip size="sm" emphasis="soft" color="warning" label="Deprecated" />
                )}
              </Stack>

              {/* Date */}
              {v.created && (
                <Box component="span" title={formatDate(v.created)}>
                  <Text size="xs" sx={dateTextSx}>
                    {relativeTime(v.created)}
                  </Text>
                </Box>
              )}
            </Stack>
          );
        })}
      </Stack>
    ) : (
      <Text size="sm" sx={emptyTextSx}>
        {loading ? 'Loading versions...' : 'No versions available'}
      </Text>
    )}
  </TabPanel>
);

ChartVersionsTab.displayName = 'ChartVersionsTab';
export default ChartVersionsTab;
