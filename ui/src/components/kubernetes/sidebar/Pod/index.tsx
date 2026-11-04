import { Stack } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import { Pod } from 'kubernetes-types/core/v1';
import React from 'react';

import DebugSessionsSection from '../../../../features/debug/DebugSessionsSection';
import MetadataSection from '../../../shared/sidebar/pages/overview/sections/MetadataSection';

import PodConfigSection from './PodConfigSection';
import PodContainersSection from './PodContainersSection';
import PodStatusSection from './PodStatusSection';
import PodVolumesSection from './PodVolumesSection';
import PodMetricsSection from './PodMetricsSection';
import { metricSidebarProps } from '../metricsDrawerViews';

import { podMetricResource, usePodResourceSetMetrics } from '@/hooks/usePodMetricsBatch';
import { aggregateMetricValue } from '../metricPresentation';

interface Props {
  ctx: DrawerContext<Pod>;
}

export const PodSidebar: React.FC<Props> = ({ ctx }) => {
  const pod = ctx.data;
  const connectionID = ctx.resource?.route.connection || '';
  const resourceID = ctx.resource?.reference.address.id || '';

  const { data: metricsData } = usePodResourceSetMetrics({
    connectionID,
    resources: ctx.resource?.record ? [podMetricResource(ctx.resource.record)] : [],
    bindingID: 'native',
  });
  const podCpuUsage = aggregateMetricValue(metricsData?.results, 'cpu_usage');
  const podMemoryUsage = aggregateMetricValue(metricsData?.results, 'memory_usage');

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
      <PodMetricsSection {...metricSidebarProps(ctx)} />

      {/* Containers — separated by section heading */}
      <PodContainersSection
        resourceID={resourceID}
        connectionID={connectionID}
        obj={pod}
        resource={ctx.resource}
        podCpuUsage={podCpuUsage}
        podMemoryUsage={podMemoryUsage}
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
