import { Chip, Grid, Stack, Text } from '@omniviewdev/base-ui';
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
import { chipStyle, containerStyle, headerStyle, infoCardStyle } from './styles';

const sliceGridStyle: React.CSSProperties = { gap: 6 };

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
    <div style={containerStyle}>
      {/* ── Header: dot + name + type chip + restart count + status ── */}
      <Stack direction="row" spacing={2} align="center" style={headerStyle}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: statusDotColor(status),
            flexShrink: 0,
          }}
        />
        <Text weight="semibold" size="sm" truncate style={{ flex: 1 }}>
          {container.name}
        </Text>
        {label && chipColor && (
          <Chip size="xs" color={chipColor} variant="soft" style={chipStyle}>
            {label}
          </Chip>
        )}
        {status && !!status.restartCount && (
          <Chip size="xs" color={getRestartChipColor(status)} variant="soft" style={chipStyle}>
            {`${status.restartCount} restart${status.restartCount !== 1 ? 's' : ''}`}
          </Chip>
        )}
        {status && <ContainerStatusDecorator status={status} />}
      </Stack>

      {/* ── Subsections within the shared container frame ── */}
      <Grid columns={12} spacing={0} style={sliceGridStyle}>
        {/* Restart / termination info — shown when container has issues */}
        {status && ((status.restartCount ?? 0) > 0 || status.state?.waiting || status.state?.terminated || status.lastState?.terminated) && (
          <Grid.Item span={12}>
            <ContainerStatusSection status={status} />
          </Grid.Item>
        )}

        {/* Image / Command / Args — full width, wrapping text */}
        <Grid.Item span={12}>
          <div style={infoCardStyle}>
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
          </div>
        </Grid.Item>

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
    </div>
  );
};

export default ContainerSlice;
