import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { Node } from 'kubernetes-types/core/v1';
import React from 'react';

import { convertKubernetesByteUnits } from '../../../../utils/convert';

const outerBoxSx = { borderRadius: 1, border: '1px solid', borderColor: 'divider' } as const;
const titleAreaSx = { py: 0.5, px: 1 } as const;
const contentAreaSx = { py: 0.5, px: 1, bgcolor: 'background.level1' } as const;
const resourceRowSx = { py: 0.25 } as const;
const resourceLabelSx = { fontWeight: 600, minWidth: 60 } as const;
const capacityTextSx = { color: 'neutral.300' } as const;
const usageBarRowSx = { mt: 0.25 } as const;
const progressBarSx = { flex: 1, height: 6, borderRadius: 3 } as const;
const usageTextSx = { color: 'neutral.400', minWidth: 44, textAlign: 'right' } as const;

interface Props {
  node: Node;
  /** CPU usage in millicores (from metrics) */
  cpuUsage?: number;
  /** CPU capacity in millicores */
  cpuCapacity?: number;
  /** Memory usage in bytes (from metrics) */
  memoryUsage?: number;
  /** Memory capacity in bytes */
  memoryCapacity?: number;
}

const ResourceRow: React.FC<{
  label: string;
  capacity?: string;
  allocatable?: string;
  usage?: number; // 0..100 percent
  usageLabel?: string;
}> = ({ label, capacity, allocatable, usage, usageLabel }) => (
  <Box sx={resourceRowSx}>
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Text size="xs" sx={resourceLabelSx}>
        {label}
      </Text>
      <Stack direction="row" gap={1.5} alignItems="center">
        <Text size="xs" sx={capacityTextSx}>
          {allocatable ?? '-'} / {capacity ?? '-'}
        </Text>
      </Stack>
    </Stack>
    {usage != null && (
      <Stack direction="row" gap={1} alignItems="center" sx={usageBarRowSx}>
        <LinearProgress
          variant="determinate"
          value={Math.min(usage, 100)}
          color={usage > 90 ? 'error' : usage > 70 ? 'warning' : 'primary'}
          sx={progressBarSx}
        />
        <Text size="xs" sx={usageTextSx}>
          {usageLabel || `${usage.toFixed(1)}%`}
        </Text>
      </Stack>
    )}
  </Box>
);

/** Parse a Kubernetes CPU quantity like "4" or "4000m" to millicores. */
function cpuToMillicores(value?: string): number | undefined {
  if (!value) return undefined;
  if (value.endsWith('m')) return parseInt(value, 10);
  return parseFloat(value) * 1000;
}

/** Parse a Kubernetes memory quantity to bytes. */
function memoryToBytes(value?: string): number | undefined {
  if (!value) return undefined;
  const units: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
  };
  for (const [suffix, factor] of Object.entries(units)) {
    if (value.endsWith(suffix)) {
      return parseFloat(value.replace(suffix, '')) * factor;
    }
  }
  return parseFloat(value);
}

const NodeResourcesSection: React.FC<Props> = ({
  node,
  cpuUsage,
  cpuCapacity: cpuCapacityOverride,
  memoryUsage,
  memoryCapacity: memoryCapacityOverride,
}) => {
  const capacity = node.status?.capacity;
  const allocatable = node.status?.allocatable;

  const cpuCap = cpuCapacityOverride ?? cpuToMillicores(capacity?.cpu);
  const memCap = memoryCapacityOverride ?? memoryToBytes(capacity?.memory);

  const cpuPercent = cpuUsage != null && cpuCap ? (cpuUsage / cpuCap) * 100 : undefined;
  const memPercent = memoryUsage != null && memCap ? (memoryUsage / memCap) * 100 : undefined;

  return (
    <Box sx={outerBoxSx}>
      <Box sx={titleAreaSx}>
        <Text weight="semibold" size="sm">
          Resources
        </Text>
      </Box>
      <Divider />
      <Box sx={contentAreaSx}>
        <ResourceRow
          label="CPU"
          capacity={capacity?.cpu}
          allocatable={allocatable?.cpu}
          usage={cpuPercent}
          usageLabel={cpuUsage != null ? `${cpuUsage.toFixed(0)}m` : undefined}
        />
        <ResourceRow
          label="Memory"
          capacity={convertKubernetesByteUnits({ from: capacity?.memory || '', to: 'GB' })}
          allocatable={convertKubernetesByteUnits({ from: allocatable?.memory || '', to: 'GB' })}
          usage={memPercent}
          usageLabel={
            memoryUsage != null
              ? convertKubernetesByteUnits({ from: `${Math.round(memoryUsage)}B`, to: 'GB' })
              : undefined
          }
        />
        <ResourceRow
          label="Storage"
          capacity={convertKubernetesByteUnits({
            from: capacity?.['ephemeral-storage'] || '',
            to: 'GB',
          })}
          allocatable={convertKubernetesByteUnits({
            from: allocatable?.['ephemeral-storage'] || '',
            to: 'GB',
          })}
        />
        <ResourceRow label="Pods" capacity={capacity?.pods} allocatable={allocatable?.pods} />
      </Box>
    </Box>
  );
};

export default NodeResourcesSection;
