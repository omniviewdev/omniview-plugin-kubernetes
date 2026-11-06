import { Grid, Stack, Text } from '@omniviewdev/base-ui';
import { CapacityBar } from '@omniviewdev/base-ui/metrics';
import type { Container } from 'kubernetes-types/core/v1';
import React from 'react';

import Icon from '../../../../shared/Icon';

import { fontSize13Style, resourceCardBodyStyle, resourceCardHeaderStyle, resourceCardStyle } from './styles';

import { parseResourceQuantity } from '@/utils/convert';


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
  const cpuRequest = parseResourceQuantity(cpuReq);
  const cpuLimit = parseResourceQuantity(cpuLim);
  const memoryRequest = parseResourceQuantity(memReq);
  const memoryLimit = parseResourceQuantity(memLim);


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
          <CapacityBar value={null} unit={{ kind: 'cpu', base: 'cores' }} label="CPU"
            references={[
              { id: 'request', kind: 'line', label: 'Request', value: cpuRequest, lineStyle: 'dashed', tone: 'neutral', source: 'Current resource configuration' },
              { id: 'limit', kind: 'line', label: 'Limit', value: cpuLimit != null && cpuLimit > 0 ? cpuLimit : undefined, lineStyle: 'dotted', tone: 'neutral', source: 'Current resource configuration' },
            ]}
            bound={cpuLimit != null && cpuLimit > 0 ? { value: cpuLimit, kind: 'limit' } : undefined} />
          <CapacityBar value={null} unit={{ kind: 'bytes', display: 'binary' }} label="Memory"
            references={[
              { id: 'request', kind: 'line', label: 'Request', value: memoryRequest, lineStyle: 'dashed', tone: 'neutral', source: 'Current resource configuration' },
              { id: 'limit', kind: 'line', label: 'Limit', value: memoryLimit != null && memoryLimit > 0 ? memoryLimit : undefined, lineStyle: 'dotted', tone: 'neutral', source: 'Current resource configuration' },
            ]}
            bound={memoryLimit != null && memoryLimit > 0 ? { value: memoryLimit, kind: 'limit' } : undefined} />
          <Text size="xs" tone="muted">Container usage unavailable. Pod totals are not container measurements.</Text>
          {(storReq || storLim) && <Text size="xs" tone="muted">Storage request {storReq ?? 'unknown'} · limit {storLim ?? 'unknown'}</Text>}
        </div>
      </div>
    </Grid.Item>
  );
};

export default ContainerResourcesSection;
