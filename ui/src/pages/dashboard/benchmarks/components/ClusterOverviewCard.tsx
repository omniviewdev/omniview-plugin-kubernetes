import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text, Heading } from '@omniviewdev/ui/typography';
import * as React from 'react';

const cardWrapperSx = { p: 0.5 } as const;

const scoreBoxSx = {
  alignItems: 'center',
  justifyContent: 'center',
  px: 3,
  display: 'flex',
  gap: 2,
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 1,
} as const;

const statusBoxSx = {
  bgcolor: 'background.level1',
  borderRadius: 1,
  p: 1,
  display: 'flex',
  flex: 1,
  gap: 2,
} as const;

const flexOneSx = { flex: 1 } as const;

const scoreLabelSx = { fontWeight: 'bold', color: 'primary.main' } as const;

const scoreValueSx = { fontWeight: 'bold' } as const;

const passingLabelSx = { fontWeight: 'bold', color: 'success.main' } as const;

const warningLabelSx = { fontWeight: 'bold', color: 'warning.main' } as const;

const failingLabelSx = { fontWeight: 'bold', color: 'error.main' } as const;

const boldSx = { fontWeight: 'bold' } as const;

type Props = {
  cluster: string;
  icon: string;
  passing: number;
  warning: number;
  failing: number;
  score: number;
};

export const ClusterOverviewCard: React.FC<Props> = ({ passing, warning, failing, score }) => {
  return (
    <Box sx={cardWrapperSx}>
      <Stack direction="row" gap={1}>
        <Box
          sx={scoreBoxSx}
        >
          <Stack direction="column" sx={flexOneSx}>
            <Text size="xs" sx={scoreLabelSx}>
              Score
            </Text>
            <Heading level={4} sx={scoreValueSx}>
              {score}
            </Heading>
          </Stack>
        </Box>
        <Box
          sx={statusBoxSx}
        >
          <Stack direction="column" sx={flexOneSx}>
            <Text size="xs" sx={passingLabelSx}>
              Passing
            </Text>
            <Text sx={boldSx}>{passing}</Text>
          </Stack>
          <Stack direction="column" sx={flexOneSx}>
            <Text size="xs" sx={warningLabelSx}>
              Warning
            </Text>
            <Text sx={boldSx}>{warning}</Text>
          </Stack>
          <Stack direction="column" sx={flexOneSx}>
            <Text size="xs" sx={failingLabelSx}>
              Failing
            </Text>
            <Text sx={boldSx}>{failing}</Text>
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
};

export default ClusterOverviewCard;
