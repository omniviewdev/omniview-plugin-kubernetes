import { Stack } from '@omniviewdev/base-ui';
import { DrawerContext, useMetricOwnerConnection, useResourceMetrics } from '@omniviewdev/runtime';
import { Node } from 'kubernetes-types/core/v1';
import React from 'react';

// types

// sections

import ResourceMetricPanels from '../../shared/ResourceMetricPanels';
import MetadataSection from '../../shared/sidebar/pages/overview/sections/MetadataSection';

import NodeImagesSection from './Node/NodeImagesSection';
import NodePodsSection from './Node/NodePodsSection';
import NodeResourcesSection from './Node/NodeResourcesSection';
import NodeStatusSection from './Node/NodeStatusSection';
import NodeSystemSection from './Node/NodeSystemSection';
import NodeTopologySection from './Node/NodeTopologySection';

import { PLUGIN_ID } from '@/pluginId';
import { parseResourceQuantity } from '@/utils/convert';

interface Props {
  ctx: DrawerContext<Node>;
}
export function NodeMetricsView({ ctx }: { ctx: DrawerContext<unknown> }) {
  const node = ctx.data as Node | undefined;
  const connection = useMetricOwnerConnection(PLUGIN_ID, ctx.resource?.route.connection ?? '');
  const cpu = node?.status?.capacity?.cpu;
  const memory = node?.status?.capacity?.memory;
  const cpuCapacity = parseResourceQuantity(cpu);
  const memoryCapacity = parseResourceQuantity(memory);
  return <ResourceMetricPanels connectionID={ctx.resource?.route.connection ?? ''}
    resourceKey={ctx.resource?.reference.address.type ?? 'k8s:/nodes'}
    resourceID={ctx.resource?.reference.address.id ?? ''}
    reference={ctx.resource?.reference} route={ctx.resource?.route}
    defaultMetricIDs={['kubernetes.node.cpu.usage', 'kubernetes.node.memory.working_set']}
    presentation={{
      'kubernetes.node.cpu.usage': { bound: cpuCapacity != null && Number.isFinite(cpuCapacity) && cpuCapacity > 0 ? { kind: 'capacity', value: cpuCapacity } : undefined },
      'kubernetes.node.memory.working_set': { bound: memoryCapacity != null && Number.isFinite(memoryCapacity) && memoryCapacity > 0 ? { kind: 'capacity', value: memoryCapacity } : undefined },
    }}
    identityLabels={(result, publicScope) => {
      const cluster = publicScope.cluster || connection?.name;
      const name = result?.resourceReference.address.id ?? ctx.resource?.reference.address.id ?? node?.metadata?.name;
      return { ...(cluster ? { cluster } : {}), ...(name ? { node: name } : {}) };
    }} />;
}

export const NodeSidebar: React.FC<Props> = ({ ctx }) => {
  const node = ctx.data;
  const connectionID = ctx.resource?.route.connection || '';
  const resourceID = ctx.resource?.reference.address.id || '';

  // Fetch live CPU/memory metrics for this node.
  const { data: metricsData } = useResourceMetrics({
    pluginID: PLUGIN_ID,
    connectionID,
    resourceKey: 'k8s:/nodes',
    resourceID,
    resourceData: ctx.resource?.record?.record.body,
    reference: ctx.resource?.reference,
    route: ctx.resource?.route,
    metricIDs: [
      'cpu_usage',
      'cpu_capacity',
      'memory_usage',
      'memory_capacity',
      'prom_cpu_utilization',
      'prom_memory_utilization',
    ],
    shape: 0, // CURRENT
    refreshInterval: 15_000,
    enabled: !!connectionID && !!resourceID,
  });

  // Extract CPU/memory values from metrics response.
  const CPU_USAGE_IDS = new Set(['cpu_usage', 'prom_cpu_utilization']);
  const CPU_CAP_IDS = new Set(['cpu_capacity']);
  const MEM_USAGE_IDS = new Set(['memory_usage', 'prom_memory_utilization']);
  const MEM_CAP_IDS = new Set(['memory_capacity']);

  let cpuUsage: number | undefined;
  let cpuCapacity: number | undefined;
  let memoryUsage: number | undefined;
  let memoryCapacity: number | undefined;

  if (metricsData) {
    for (const resp of Object.values(metricsData)) {
      if (!resp?.success || !resp.results) continue;
      for (const result of resp.results) {
        const mid = result.current_value?.metric_id ?? '';
        const val = result.current_value?.value;
        if (val == null) continue;

        if (CPU_USAGE_IDS.has(mid) && cpuUsage == null) cpuUsage = val;
        else if (CPU_CAP_IDS.has(mid) && cpuCapacity == null) cpuCapacity = val;
        else if (MEM_USAGE_IDS.has(mid) && memoryUsage == null) memoryUsage = val;
        else if (MEM_CAP_IDS.has(mid) && memoryCapacity == null) memoryCapacity = val;
      }
    }
  }

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

      {/* Topology + Karpenter */}
      <NodeTopologySection node={node} />

      <NodePodsSection connectionID={connectionID} nodeName={node.metadata?.name} />

      {/* Images */}
      <NodeImagesSection node={node} />
    </Stack>
  );
};

NodeSidebar.displayName = 'NodeSidebar';
export default NodeSidebar;
