import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type React from 'react';

import { sectionWrapperStackSx, sectionWrapperHeaderSx, sectionDescriptionSx, sectionWrapperBodySx } from './constants';

function SectionWrapper({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Stack direction="column" gap={0} sx={sectionWrapperStackSx}>
      <Box
        sx={sectionWrapperHeaderSx}
      >
        <Stack direction="column" gap={0.25}>
          <Text weight="semibold" size="lg">
            {title}
          </Text>
          <Text size="xs" sx={sectionDescriptionSx}>
            {description}
          </Text>
        </Stack>
      </Box>
      <Box sx={sectionWrapperBodySx}>{children}</Box>
    </Stack>
  );
}

export default SectionWrapper;
