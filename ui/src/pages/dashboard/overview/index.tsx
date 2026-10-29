import { Stack, Text } from '@omniviewdev/base-ui';
import {
  useConnection,
  useExtensionPoint,
  usePluginRouter,
  useResources,
} from '@omniviewdev/runtime';
import type { Pod, Node as K8sNode, Event as K8sEvent } from 'kubernetes-types/core/v1';
import React from 'react';
import { useParams } from 'react-router';

import type { ChartTimeRange } from '../../../components/shared/charts';
import NamespaceSelect from '../../../components/tables/NamespaceSelect';
import { useClusterPreferences } from '../../../hooks/useClusterPreferences';

import ClusterInfoCard from './components/ClusterInfoCard';
import ClusterMetricsSection from './components/ClusterMetricsSection';
import ClusterResourceGauges from './components/ClusterResourceGauges';

const pageStyle: React.CSSProperties = {
  padding: 12,
  overflow: 'auto',
  height: '100%',
  width: '100%',
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
};

// EventsTable scrolls its own list, so the frame clips instead of adding a
// second set of scrollbars.
const eventsContainerStyle: React.CSSProperties = {
  height: 'clamp(300px, 40vh, 600px)',
  overflow: 'hidden',
  border: '1px solid var(--ov-color-border-default)',
  borderRadius: 4,
};

/** Six equal columns (MUI Grid md=2 of 12). */
const workloadGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
  gap: 12,
};

/** Three equal columns (MUI Grid md=4 of 12). */
const widgetGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 12,
};

import {
  PodStatCard,
  DeploymentStatCard,
  StatefulSetStatCard,
  DaemonSetStatCard,
  JobStatCard,
  CronJobStatCard,
} from './components/WorkloadStatCards';
import EventsTable from './EventsTable';


/**
 * Generic filter for namespaced K8s resources.
 * Accepts any object with an optional metadata?.namespace field.
 */
function filterByNamespace<T extends { metadata?: { namespace?: string } }>(
  resources: T[],
  namespaces: string[],
): T[] {
  if (namespaces.length === 0) return resources;
  return resources.filter((r) => namespaces.includes(r.metadata?.namespace ?? ''));
}

const ClusterDashboardOverviewPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { navigate } = usePluginRouter();
  const [namespaces, setNamespaces] = React.useState<string[]>([]);
  const [timeRange, setTimeRange] = React.useState<ChartTimeRange>(() => ({
    from: new Date(Date.now() - 3600000),
    to: new Date(),
  }));

  const goToResource = React.useCallback(
    (resourceKey: string) => {
      navigate(`/cluster/${id}/resources/${resourceKey}`);
    },
    [navigate, id],
  );

  // Stable onClick callbacks per resource type
  const goToPods = React.useCallback(() => goToResource('core_v1_Pod'), [goToResource]);
  const goToDeployments = React.useCallback(
    () => goToResource('apps_v1_Deployment'),
    [goToResource],
  );
  const goToStatefulSets = React.useCallback(
    () => goToResource('apps_v1_StatefulSet'),
    [goToResource],
  );
  const goToDaemonSets = React.useCallback(() => goToResource('apps_v1_DaemonSet'), [goToResource]);
  const goToJobs = React.useCallback(() => goToResource('batch_v1_Job'), [goToResource]);
  const goToCronJobs = React.useCallback(() => goToResource('batch_v1_CronJob'), [goToResource]);

  const { connection } = useConnection({ pluginID: 'kubernetes', connectionID: id });
  const { connectionOverrides } = useClusterPreferences('kubernetes');
  const metricConfig = connectionOverrides[id]?.metricConfig;

  // Only keep the resource hooks needed for ClusterInfoCard and EventsTable
  const { resources: pods } = useResources({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey: 'core::v1::Pod',
    idAccessor: 'metadata.uid',
  });

  const { resources: nodes } = useResources({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey: 'core::v1::Node',
    idAccessor: 'metadata.uid',
  });

  const { resources: events } = useResources({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey: 'core::v1::Event',
    idAccessor: 'metadata.uid',
  });

  // --- Extension point for dashboard widgets ---
  const widgetEP = useExtensionPoint<React.FC<{ pluginID: string; connectionID: string }>>(
    'omniview/dashboard/widget',
  );
  const widgets = widgetEP?.list() ?? [];

  // --- Filtered data for health banner and events ---
  // runtime ListResult.result is typed as any[]; cast to the known K8s types
  const allPods = React.useMemo(
    () => filterByNamespace((pods.data?.result ?? []) as Pod[], namespaces),
    [pods.data, namespaces],
  );
  const allNodes = React.useMemo(() => (nodes.data?.result ?? []) as K8sNode[], [nodes.data]);
  const allEvents = React.useMemo(
    () => filterByNamespace((events.data?.result ?? []) as K8sEvent[], namespaces),
    [events.data, namespaces],
  );

  return (
    <div style={pageStyle}>
      <Stack direction="column" spacing={3}>
        {/* Cluster info + health status */}
        <ClusterInfoCard
          // Connection.data is Record<string, any> from the runtime; cast to the expected shape
          data={connection.data?.data}
          loading={connection.isLoading}
          nodes={allNodes}
          pods={allPods}
          events={allEvents}
        />

        {/* Namespace filter */}
        <Stack direction="row" align="center" spacing={2}>
          <Text size="sm" tone="muted">
            Namespace:
          </Text>
          <NamespaceSelect connectionID={id} selected={namespaces} setNamespaces={setNamespaces} />
        </Stack>

        {/* Workload summary cards — each owns its own useResources hook */}
        <div style={workloadGridStyle}>
          <PodStatCard connectionID={id} namespaces={namespaces} onClick={goToPods} />
          <DeploymentStatCard connectionID={id} namespaces={namespaces} onClick={goToDeployments} />
          <StatefulSetStatCard connectionID={id} namespaces={namespaces} onClick={goToStatefulSets} />
          <DaemonSetStatCard connectionID={id} namespaces={namespaces} onClick={goToDaemonSets} />
          <JobStatCard connectionID={id} namespaces={namespaces} onClick={goToJobs} />
          <CronJobStatCard connectionID={id} namespaces={namespaces} onClick={goToCronJobs} />
        </div>

        {/* Resource capacity gauges */}
        <ClusterResourceGauges connectionID={id} metricConfig={metricConfig} />

        {/* Cluster metrics */}
        <ClusterMetricsSection
          connectionID={id}
          namespace={namespaces[0] || ''}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          metricConfig={metricConfig}
        />

        {/* Extension widget slot */}
        {widgets.length > 0 && (
          <div style={widgetGridStyle}>
            {widgets.map((w) => {
              const Component = w.value;
              return (
                <div key={w.id} style={{ minWidth: 0 }}>
                  <Component pluginID="kubernetes" connectionID={id} />
                </div>
              );
            })}
          </div>
        )}

        {/* Recent events — responsive height, scrolls independently */}
        <Stack direction="column" spacing={1} style={{ gap: 6 }}>
          <Text weight="semibold" size="sm">
            Recent Events ({allEvents.length})
          </Text>
          <div style={eventsContainerStyle}>
            <EventsTable events={allEvents} loading={events.isLoading} connectionID={id} />
          </div>
        </Stack>
      </Stack>
    </div>
  );
};

export default ClusterDashboardOverviewPage;
