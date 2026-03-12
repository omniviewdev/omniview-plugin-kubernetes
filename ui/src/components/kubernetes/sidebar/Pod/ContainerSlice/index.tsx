import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';

import { ContainerStatusDecorator } from '../ContainerStatuses';

import ContainerEnvironmentSection from './ContainerEnvironmentSection';
import ContainerPortsSection from './ContainerPortsSection';
import ContainerProbesSection from './ContainerProbesSection';
import ContainerResourcesSection from './ContainerResourcesSection';
import ContainerStatusSection from './ContainerStatusSection';
import ContainerVolumesSection from './ContainerVolumesSection';
import type { ContainerSliceProps } from './helpers';
import { getRestartChipColor, statusDotColor, typeChipColor, typeLabel } from './helpers';
import InfoRow from './InfoRow';
import { chipSx, containerSx, headerSx, infoCardSx } from './styles';

export type { ContainerSliceProps } from './helpers';

const ContainerSlice: React.FC<ContainerSliceProps> = ({
  resourceID,
  connectionID,
  container,
  status,
  type,
  pod,
  volumes,
  podCpuUsage,
  podMemoryUsage,
}) => {
  const label = typeLabel(type);
  const chipColor = typeChipColor(type);

  return (
    <Box sx={containerSx}>
      {/* ── Header: dot + name + type chip + restart count + status ── */}
      <Stack direction="row" spacing={1} alignItems="center" sx={headerSx}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: statusDotColor(status),
            flexShrink: 0,
          }}
        />
        <Text weight="semibold" size="sm" noWrap sx={{ flex: 1 }}>
          {container.name}
        </Text>
        {label && chipColor && (
          <Chip
            size="xs"
            color={chipColor}
            emphasis="soft"
            sx={chipSx}
            label={label}
          />
        )}
        {status && !!status.restartCount && (
          <Chip
            size="xs"
            color={getRestartChipColor(status)}
            emphasis="soft"
            sx={chipSx}
            label={`${status.restartCount} restart${status.restartCount !== 1 ? 's' : ''}`}
          />
        )}
        {status && <ContainerStatusDecorator status={status} />}
      </Stack>

      {/* ── Card-based sub-sections ── */}
      <Grid container spacing={0.75}>
        {/* Restart / termination info — shown when container has issues */}
        {status && (status.restartCount ?? 0) > 0 && (
          <Grid size={12}>
            <ContainerStatusSection status={status} />
          </Grid>
        )}

        {/* Image / Command / Args — full width, wrapping text */}
        <Grid size={12}>
          <Box sx={infoCardSx}>
            <InfoRow icon="LuImage" label="Image" value={container.image || ''} />
            {!!container.command?.length && (
              <InfoRow
                icon="LuTerminalSquare"
                label="Command"
                value={container.command.join(' ')}
              />
            )}
            {!!container.args?.length && (
              <InfoRow icon="LuTerminal" label="Args" value={container.args.join(' ')} />
            )}
          </Box>
        </Grid>

        {/* Resources with utilization bars — full width */}
        <ContainerResourcesSection
          container={container}
          podCpuUsage={podCpuUsage}
          podMemoryUsage={podMemoryUsage}
        />

        {/* Probes — split evenly based on count */}
        <ContainerProbesSection container={container} />

        {/* Ports — full width with forwarding controls */}
        <ContainerPortsSection
          resourceID={resourceID}
          connectionID={connectionID}
          container={container}
          pod={pod}
        />

        {/* Environment Variables — full width */}
        <ContainerEnvironmentSection
          container={container}
          pod={pod}
          connectionID={connectionID}
        />

        {/* Volume Mounts — full width */}
        <ContainerVolumesSection
          container={container}
          connectionID={connectionID}
          pod={pod}
          volumes={volumes}
        />
      </Grid>
    </Box>
  );
};

export default ContainerSlice;
