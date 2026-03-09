import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { SxProps, Theme } from '@mui/material/styles';
import React from 'react';

const sectionBorderSx = {
  borderRadius: 1,
  border: '1px solid',
  borderColor: 'divider',
} as const;

const simpleHeaderSx = { py: 0.5, px: 1 } as const;

const flexHeaderSx = {
  py: 0.5,
  px: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1,
} as const;

const defaultBodySx = { py: 0.5, px: 1, bgcolor: 'background.level1' } as const;

interface SidebarSectionProps {
  title: string;
  headerRight?: React.ReactNode;
  headerLeft?: React.ReactNode;
  bodySx?: SxProps<Theme>;
  children: React.ReactNode;
}

const SidebarSection: React.FC<SidebarSectionProps> = ({
  title,
  headerRight,
  headerLeft,
  bodySx,
  children,
}) => {
  const useFlexHeader = !!headerRight;

  return (
    <Box sx={sectionBorderSx}>
      <Box sx={useFlexHeader ? flexHeaderSx : simpleHeaderSx}>
        {headerLeft ? (
          <Stack direction="row" gap={0.75} alignItems="center">
            <Text weight="semibold" size="sm">
              {title}
            </Text>
            {headerLeft}
          </Stack>
        ) : (
          <Text weight="semibold" size="sm">
            {title}
          </Text>
        )}
        {headerRight}
      </Box>
      <Divider />
      <Box sx={bodySx ? { ...defaultBodySx, ...(bodySx as object) } : defaultBodySx}>
        {children}
      </Box>
    </Box>
  );
};

export default SidebarSection;
