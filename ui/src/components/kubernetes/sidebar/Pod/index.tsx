import { Stack, Text } from '@omniviewdev/base-ui';
import { MetricValue } from '@omniviewdev/base-ui/metrics';
import { DrawerContext, useMetricObservation } from '@omniviewdev/runtime';
import { Pod } from 'kubernetes-types/core/v1';
import React from 'react';

import DebugSessionsSection from '../../../../features/debug/DebugSessionsSection';
import MetadataSection from '../../../shared/sidebar/pages/overview/sections/MetadataSection';

import PodConfigSection from './PodConfigSection';
import PodContainersSection from './PodContainersSection';
import PodStatusSection from './PodStatusSection';
import PodVolumesSection from './PodVolumesSection';

import { PLUGIN_ID } from '@/pluginId';

interface Props {
  ctx: DrawerContext<Pod>;
}

export const PodSidebar: React.FC<Props> = ({ ctx }) => {
  const pod = ctx.data;
  const connectionID = ctx.resource?.route.connection || '';
  const resourceID = ctx.resource?.reference.address.id || '';

  const targets = React.useMemo(() => ctx.resource
    ? [{ token: resourceID, reference: ctx.resource.reference, route: ctx.resource.route }] : [],
  [ctx.resource, resourceID]);
  const { results } = useMetricObservation({
    ownerPluginID: PLUGIN_ID,
    ownerConnectionID: connectionID,
    resourceKey: 'k8s:/pods',
    targets,
    metricIDs: ['kubernetes.pod.cpu.usage', 'kubernetes.pod.memory.working_set'],
    shape: 'current',
    intervalMs: 15_000,
    enabled: !!connectionID && targets.length > 0,
  });
  const cpu = results.find(result => result.resourceToken === resourceID && result.metricID === 'kubernetes.pod.cpu.usage');
  const memory = results.find(result => result.resourceToken === resourceID && result.metricID === 'kubernetes.pod.memory.working_set');
  const podCpuUsage = cpu?.status === 'ok' ? cpu.value : null;
  const podMemoryUsage = memory?.status === 'ok' && memory.value != null ? memory.value : undefined;

  if (!pod) {
    return null;
  }

  return (
    <Stack direction="column" spacing={4} style={{ width: '100%' }}>
      {/* Pod details — tightly grouped */}
      <Stack direction="column" spacing={1}>
        <MetadataSection data={pod.metadata} connectionID={connectionID} />
        <PodStatusSection pod={pod} connectionID={connectionID} />
        <PodConfigSection pod={pod} connectionID={connectionID} />
      </Stack>
      <DebugSessionsSection connectionID={connectionID} pod={pod} />
      <Stack direction="row" spacing={3} aria-label="Pod current usage">
        {cpu?.unit ? <MetricValue value={podCpuUsage} unit={cpu.unit} size="sm" aria-label="Pod CPU usage" /> : <Text size="xs" tone="muted">CPU unit unavailable</Text>}
        {memory?.unit ? <MetricValue value={podMemoryUsage ?? null} unit={memory.unit} size="sm" aria-label="Pod memory working set" /> : <Text size="xs" tone="muted">Memory unit unavailable</Text>}
      </Stack>

      {/* Containers — separated by section heading */}
      <PodContainersSection
        resourceID={resourceID}
        connectionID={connectionID}
        obj={pod}
        resource={ctx.resource}
      />

      {/* Volumes — separated by section heading */}
      <PodVolumesSection
        pod={pod}
        connectionID={connectionID}
        namespace={pod.metadata?.namespace}
      />
    </Stack>
  );
};

PodSidebar.displayName = 'PodSidebar';
export default PodSidebar;
