import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { Node } from 'kubernetes-types/core/v1';
import type { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';

import ConditionChip from '../../../shared/ConditionChip';

const outerBoxSx = { borderRadius: 1, border: '1px solid', borderColor: 'divider' } as const;
const statusHeaderSx = {
  py: 0.5,
  px: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1,
} as const;
const chipSx = { borderRadius: 1 } as const;
const contentAreaSx = { py: 0.5, px: 1, bgcolor: 'background.level1' } as const;
const entryRowSx = { minHeight: 22, alignItems: 'center' } as const;
const entryLabelSx = { color: 'neutral.300' } as const;
const entryValueSx = { fontWeight: 600, fontSize: 12 } as const;

interface Props {
  node: Node;
}

const StatusEntry: React.FC<{
  label: string;
  value?: string | React.ReactNode;
}> = ({ label, value }) => {
  if (value === undefined || value === null) return null;
  return (
    <Grid container spacing={0} sx={entryRowSx}>
      <Grid size={3}>
        <Text sx={entryLabelSx} size="xs">
          {label}
        </Text>
      </Grid>
      <Grid size={9}>
        {typeof value === 'string' ? (
          <Text sx={entryValueSx} size="xs">
            {value}
          </Text>
        ) : (
          value
        )}
      </Grid>
    </Grid>
  );
};

const NodeStatusSection: React.FC<Props> = ({ node }) => {
  const conditions = node.status?.conditions;
  const addresses = node.status?.addresses;
  const unschedulable = node.spec?.unschedulable;

  // Determine overall phase from Ready condition.
  const readyCondition = conditions?.find((c) => c.type === 'Ready');
  const phase = readyCondition?.status === 'True' ? 'Ready' : 'Not Ready';
  const phaseColor = phase === 'Ready' ? 'success' : 'danger';

  return (
    <Box sx={outerBoxSx}>
      <Box sx={statusHeaderSx}>
        <Stack direction="row" gap={0.75} alignItems="center" flexShrink={0}>
          <Text weight="semibold" size="sm">
            Status
          </Text>
          <Chip
            size="xs"
            color={phaseColor}
            emphasis="soft"
            sx={chipSx}
            label={phase}
          />
          {unschedulable && (
            <Chip
              size="xs"
              color="warning"
              emphasis="soft"
              sx={chipSx}
              label="Cordoned"
            />
          )}
        </Stack>
        {conditions && conditions.length > 0 && (
          <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="flex-end">
            {conditions.map((c) => (
              <ConditionChip
                key={c.type}
                condition={c as unknown as Condition}
                flipped={c.type !== 'Ready'}
                unhealthyColor="warning"
              />
            ))}
          </Stack>
        )}
      </Box>
      <Divider />
      <Box sx={contentAreaSx}>
        {addresses?.map((addr) => (
          <StatusEntry key={addr.type} label={addr.type || ''} value={addr.address} />
        ))}
        {node.spec?.podCIDR && <StatusEntry label="Pod CIDR" value={node.spec.podCIDR} />}
      </Box>
    </Box>
  );
};

export default NodeStatusSection;
