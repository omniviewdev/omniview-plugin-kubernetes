import { Grid, Stack, Text } from '@omniviewdev/base-ui';
import { CapacityBar } from '@omniviewdev/base-ui/metrics';
import type { Container } from 'kubernetes-types/core/v1';
import React from 'react';

import Icon from '../../../../shared/Icon';

import { parseCpuToMillicores, parseMemoryToBytes } from './helpers';
import { fontSize13Style, resourceCardBodyStyle, resourceCardHeaderStyle, resourceCardStyle } from './styles';


export interface ContainerResourcesSectionProps {
  container: Container;
}

const ContainerResourcesSection: React.FC<ContainerResourcesSectionProps> = ({
  container,
}) => {
  // ── Resource values ──
  const cpuReq = container.resources?.requests?.cpu;
  const cpuLim = container.resources?.limits?.cpu;
  const memReq = container.resources?.requests?.memory;
  const memLim = container.resources?.limits?.memory;
  const storReq = container.resources?.requests?.['ephemeral-storage'];
  const storLim = container.resources?.limits?.['ephemeral-storage'];


  return (
    <Grid.Item span={12}>
      <div style={resourceCardStyle}>
        <div style={resourceCardHeaderStyle}>
          <Stack direction="row" spacing={1} align="center">
            <Icon name="LuGauge" size={14} />
            <Text style={fontSize13Style} weight="semibold">
              Resources
            </Text>
          </Stack>
        </div>
        <div style={resourceCardBodyStyle}>
          <CapacityBar value={null} unit={{ kind: 'cpu', base: 'millicores' }} label="CPU"
            request={cpuReq ? parseCpuToMillicores(cpuReq) : null}
            bound={cpuLim ? { value: parseCpuToMillicores(cpuLim), kind: 'limit' } : undefined} />
          <CapacityBar value={null} unit={{ kind: 'bytes', display: 'binary' }} label="Memory"
            request={memReq ? parseMemoryToBytes(memReq) : null}
            bound={memLim ? { value: parseMemoryToBytes(memLim), kind: 'limit' } : undefined} />
          <Text size="xs" tone="muted">Container usage unavailable. Pod totals are not container measurements.</Text>
          {(storReq || storLim) && <Text size="xs" tone="muted">Storage request {storReq ?? 'unknown'} · limit {storLim ?? 'unknown'}</Text>}
        </div>
      </div>
    </Grid.Item>
  );
};

export default ContainerResourcesSection;
