import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import { Chip, ClipboardText } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { formatRelative } from 'date-fns';
import type { Pod } from 'kubernetes-types/core/v1';
import { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';

import ConditionChip from '../../../shared/ConditionChip';
import ResourceLinkChip from '../../../shared/ResourceLinkChip';

const statusEntryGridSx = { minHeight: 22, alignItems: 'center' } as const;

const statusEntryLabelSx = { color: 'neutral.300' } as const;

const statusEntryValueSx = { fontWeight: 600, fontSize: 12 } as const;

const sectionBorderSx = {
  borderRadius: 1,
  border: '1px solid',
  borderColor: 'divider',
} as const;

const headerSx = {
  py: 0.5,
  px: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1,
} as const;

const chipBorderRadiusSx = { borderRadius: 1 } as const;

const bodyBgSx = {
  py: 0.5,
  px: 1,
  bgcolor: 'background.level1',
} as const;

interface Props {
  pod: Pod;
  /** When provided, the Node chip becomes clickable and opens the Node sidebar */
  connectionID?: string;
}

const phaseColor = (phase?: string): 'success' | 'warning' | 'primary' | 'danger' | 'neutral' | 'info' => {
  switch (phase) {
    case 'Running':
      return 'success';
    case 'Pending':
      return 'info';
    case 'Succeeded':
      return 'primary';
    case 'Failed':
      return 'danger';
    default:
      return 'neutral';
  }
};

const StatusEntry: React.FC<{
  label: string;
  value?: string | React.ReactNode;
}> = ({ label, value }) => {
  if (value === undefined || value === null) return null;
  return (
    <Grid container spacing={0} sx={statusEntryGridSx}>
      <Grid size={3}>
        <Text sx={statusEntryLabelSx} size="xs">
          {label}
        </Text>
      </Grid>
      <Grid size={9}>
        {typeof value === 'string' ? (
          <ClipboardText value={value} variant="inherit" sx={statusEntryValueSx} />
        ) : (
          value
        )}
      </Grid>
    </Grid>
  );
};

const PodStatusSection: React.FC<Props> = ({ pod, connectionID }) => {
  const phase = pod.status?.phase;
  const qosClass = pod.status?.qosClass;
  const podIP = pod.status?.podIP;
  const hostIP = pod.status?.hostIP;
  const nodeName = pod.spec?.nodeName;
  const startTime = pod.status?.startTime;
  const conditions = pod.status?.conditions;

  const totalRestarts =
    (pod.status?.containerStatuses?.reduce((sum, cs) => sum + (cs.restartCount || 0), 0) ?? 0) +
    (pod.status?.initContainerStatuses?.reduce((sum, cs) => sum + (cs.restartCount || 0), 0) ?? 0);

  return (
    <Box sx={sectionBorderSx}>
      {/* Header: title + phase chip + conditions */}
      <Box sx={headerSx}>
        <Stack direction="row" gap={0.75} alignItems="center" flexShrink={0}>
          <Text weight="semibold" size="sm">
            Status
          </Text>
          <Chip
            size="xs"
            color={phaseColor(phase)}
            emphasis="soft"
            sx={chipBorderRadiusSx}
            label={phase || 'Unknown'}
          />
        </Stack>
        {conditions && conditions.length > 0 && (
          <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="flex-end">
            {conditions.map((condition) => (
              <ConditionChip key={condition.type} condition={condition as unknown as Condition} />
            ))}
          </Stack>
        )}
      </Box>
      <Divider />
      <Box sx={bodyBgSx}>
        <StatusEntry label="QoS" value={qosClass} />
        <StatusEntry label="Pod IP" value={podIP} />
        <StatusEntry label="Host IP" value={hostIP} />
        <StatusEntry
          label="Node"
          value={
            nodeName ? (
              connectionID ? (
                <ResourceLinkChip
                  connectionID={connectionID}
                  resourceKey="core::v1::Node"
                  resourceID={nodeName}
                  resourceName={nodeName}
                />
              ) : (
                <Chip
                  size="xs"
                  color="primary"
                  emphasis="soft"
                  sx={chipBorderRadiusSx}
                  label={nodeName}
                />
              )
            ) : undefined
          }
        />
        {totalRestarts > 0 && (
          <StatusEntry
            label="Restarts"
            value={
              <Chip
                size="xs"
                color={totalRestarts > 5 ? 'danger' : 'warning'}
                emphasis="soft"
                sx={chipBorderRadiusSx}
                label={String(totalRestarts)}
              />
            }
          />
        )}
        {startTime && (
          <StatusEntry label="Started" value={formatRelative(new Date(startTime), new Date())} />
        )}
      </Box>
    </Box>
  );
};

export default PodStatusSection;
