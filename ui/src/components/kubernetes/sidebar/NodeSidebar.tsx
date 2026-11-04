import { Stack } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import { Node } from 'kubernetes-types/core/v1';
import React from 'react';

// types

// sections
import { podMetricResource, usePodResourceSetMetrics } from '@/hooks/usePodMetricsBatch';
import { aggregateMetricValue } from './metricPresentation';

import MetadataSection from '../../shared/sidebar/pages/overview/sections/MetadataSection';

import NodeImagesSection from './Node/NodeImagesSection';
import NodeResourcesSection from './Node/NodeResourcesSection';
import NodeStatusSection from './Node/NodeStatusSection';
import NodeSystemSection from './Node/NodeSystemSection';
import NodeTopologySection from './Node/NodeTopologySection';
import NodeMetricsSection from './NodeMetricsSection';

interface Props {
  ctx: DrawerContext<Node>;
}

export const NodeSidebar: React.FC<Props> = ({ ctx }) => {
  const node = ctx.data;
  const connectionID = ctx.resource?.route.connection || '';
  const resourceID = ctx.resource?.reference.address.id || '';

  const { data: metricsData } = usePodResourceSetMetrics({
    connectionID,
    resources: ctx.resource?.record ? [podMetricResource(ctx.resource.record)] : [],
    metricIDs: ['cpu_usage', 'cpu_capacity', 'memory_usage', 'memory_capacity'],
    bindingID: 'native',
  });
  const cpuUsage = aggregateMetricValue(metricsData?.results, 'cpu_usage');
  const cpuCapacity = aggregateMetricValue(metricsData?.results, 'cpu_capacity');
  const memoryUsage = aggregateMetricValue(metricsData?.results, 'memory_usage');
  const memoryCapacity = aggregateMetricValue(metricsData?.results, 'memory_capacity');

  if (!node) {
    return null;
  }

  return (
    <Stack direction="column" spacing={4} style={{ width: '100%' }}>
      {/* Core details — tightly grouped */}
      <Stack direction="column" spacing={1}>
        <MetadataSection data={node.metadata} connectionID={connectionID} />
        <NodeStatusSection node={node} />
        <NodeSystemSection node={node} />
      </Stack>

      {/* Resources with live usage gauges */}
      <NodeResourcesSection
        node={node}
        cpuUsage={cpuUsage}
        cpuCapacity={cpuCapacity}
        memoryUsage={memoryUsage}
        memoryCapacity={memoryCapacity}
      />
      <NodeMetricsSection
        connectionID={connectionID}
        resourceKey="k8s:/nodes"
        resourceID={resourceID}
        reference={ctx.resource?.reference}
        route={ctx.resource?.route}
      />

      {/* Topology + Karpenter */}
      <NodeTopologySection node={node} />

      {/* Images */}
      <NodeImagesSection node={node} />
    </Stack>
  );
};

NodeSidebar.displayName = 'NodeSidebar';
export default NodeSidebar;
