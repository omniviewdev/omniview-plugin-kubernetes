import Box from '@mui/material/Box';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text, Heading } from '@omniviewdev/ui/typography';
import React from 'react';
import { LuSearch, LuServerOff } from 'react-icons/lu';

const containerSx = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  p: 6,
  borderRadius: 'var(--ov-radius-md, 6px)',
  gap: 2,
  minHeight: 200,
  border: '1px solid var(--ov-border-default, rgba(255,255,255,0.08))',
  bgcolor: 'var(--ov-bg-surface, rgba(255,255,255,0.03))',
} as const;

const descriptionSx = { textAlign: 'center', maxWidth: 360 } as const;

type Props = {
  variant: 'no-connections' | 'no-results';
  onClearFilters?: () => void;
};

const EmptyState: React.FC<Props> = ({ variant, onClearFilters }) => (
  <Box
    sx={containerSx}
  >
    {variant === 'no-connections' ? (
      <Stack alignItems="center" gap={1.5}>
        <LuServerOff size={40} opacity={0.4} />
        <Heading level="h4">No Clusters Found</Heading>
        <Text size="sm" sx={descriptionSx}>
          No kubeconfig contexts were detected. Add kubeconfig file paths in plugin settings to get
          started.
        </Text>
      </Stack>
    ) : (
      <Stack alignItems="center" gap={1.5}>
        <LuSearch size={40} opacity={0.4} />
        <Heading level="h4">No Results</Heading>
        <Text size="sm" sx={descriptionSx}>
          No clusters match your current search or filters.
        </Text>
        {onClearFilters && (
          <Button emphasis="soft" color="neutral" size="sm" onClick={onClearFilters}>
            Clear Filters
          </Button>
        )}
      </Stack>
    )}
  </Box>
);

export default EmptyState;
