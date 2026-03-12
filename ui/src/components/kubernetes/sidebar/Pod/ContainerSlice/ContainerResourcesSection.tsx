import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { Container } from 'kubernetes-types/core/v1';
import React from 'react';

import Icon from '../../../../shared/Icon';

import { formatCpu, formatMemory, parseCpuToMillicores, parseMemoryToBytes } from './helpers';
import {
  fontSize13Sx,
  resourceBarBgSx,
  resourceBarContainerSx,
  resourceBarLabelSx,
  resourceBarRowSx,
  resourceBarTextSx,
  resourceCardBodySx,
  resourceCardHeaderSx,
  resourceCardSx,
} from './styles';

// ── Resource utilization bar row ──
const ResourceBar: React.FC<{
  label: string;
  icon: string;
  request: string;
  limit: string;
  usage?: number; // 0-100 percentage — future metrics integration
}> = ({ label, icon, request, limit, usage }) => {
  const barColor =
    usage != null
      ? usage > 80
        ? 'error.main'
        : usage > 60
          ? 'warning.main'
          : 'success.main'
      : 'primary.main';

  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={resourceBarRowSx}>
      <Stack direction="row" gap={0.75} alignItems="center" sx={resourceBarLabelSx}>
        <Icon name={icon} size={14} />
        <Text sx={fontSize13Sx}>{label}</Text>
      </Stack>
      <Box sx={resourceBarContainerSx}>
        <Box sx={resourceBarBgSx}>
          {usage != null && (
            <Box
              sx={{
                width: `${Math.min(usage, 100)}%`,
                height: '100%',
                borderRadius: 5,
                bgcolor: barColor,
                transition: 'width 0.3s ease',
              }}
            />
          )}
        </Box>
      </Box>
      <Text
        sx={resourceBarTextSx}
        noWrap
      >
        {request} / {limit}
      </Text>
    </Stack>
  );
};

export interface ContainerResourcesSectionProps {
  container: Container;
  podCpuUsage?: number;
  podMemoryUsage?: number;
}

const ContainerResourcesSection: React.FC<ContainerResourcesSectionProps> = ({
  container,
  podCpuUsage,
  podMemoryUsage,
}) => {
  // ── Resource values ──
  const cpuReq = container.resources?.requests?.cpu;
  const cpuLim = container.resources?.limits?.cpu;
  const memReq = container.resources?.requests?.memory;
  const memLim = container.resources?.limits?.memory;
  const storReq = container.resources?.requests?.['ephemeral-storage'];
  const storLim = container.resources?.limits?.['ephemeral-storage'];

  // ── Compute usage percentages from pod-level metrics ──
  const cpuDenomStr = cpuReq || cpuLim;
  const cpuUsagePercent =
    podCpuUsage != null && cpuDenomStr
      ? (podCpuUsage / parseCpuToMillicores(cpuDenomStr)) * 100
      : undefined;

  const memDenomStr = memReq || memLim;
  const memUsagePercent =
    podMemoryUsage != null && memDenomStr
      ? (podMemoryUsage / parseMemoryToBytes(memDenomStr)) * 100
      : undefined;

  // Format usage display strings
  const cpuUsageDisplay = podCpuUsage != null ? formatCpu(podCpuUsage) : undefined;
  const memUsageDisplay = podMemoryUsage != null ? formatMemory(podMemoryUsage) : undefined;

  return (
    <Grid size={12}>
      <Box sx={resourceCardSx}>
        <Box sx={resourceCardHeaderSx}>
          <Stack direction="row" gap={0.5} alignItems="center">
            <Icon name="LuGauge" size={14} />
            <Text sx={fontSize13Sx} weight="semibold">
              Resources
            </Text>
          </Stack>
        </Box>
        <Box sx={resourceCardBodySx}>
          <ResourceBar
            label="CPU"
            icon="LuCpu"
            request={
              cpuUsageDisplay ? `${cpuUsageDisplay} / ${cpuReq || '\u221E'}` : cpuReq || 'None'
            }
            limit={cpuLim || 'None'}
            usage={cpuUsagePercent}
          />
          <ResourceBar
            label="Memory"
            icon="LuMemoryStick"
            request={
              memUsageDisplay ? `${memUsageDisplay} / ${memReq || '\u221E'}` : memReq || 'None'
            }
            limit={memLim || 'None'}
            usage={memUsagePercent}
          />
          <ResourceBar
            label="Storage"
            icon="LuHardDrive"
            request={storReq || 'None'}
            limit={storLim || 'None'}
          />
        </Box>
      </Box>
    </Grid>
  );
};

export default ContainerResourcesSection;
