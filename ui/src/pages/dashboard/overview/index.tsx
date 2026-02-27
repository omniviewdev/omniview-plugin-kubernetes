import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import {
  useConnection,
  useExtensionPoint,
  usePluginRouter,
  useResources,
} from '@omniviewdev/runtime';
import type { ChartTimeRange } from '@omniviewdev/ui/charts';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { Pod, Node as K8sNode, Event as K8sEvent } from 'kubernetes-types/core/v1';
import React from 'react';
import { useParams } from 'react-router-dom';

import NamespaceSelect from '../../../components/tables/NamespaceSelect';
import { useClusterPreferences } from '../../../hooks/useClusterPreferences';

import ClusterInfoCard from './components/ClusterInfoCard';
import ClusterMetricsSection from './components/ClusterMetricsSection';
import ClusterResourceGauges from './components/ClusterResourceGauges';

const pageSx = {
  p: 1.5,
  overflow: 'auto',
  height: '100%',
  width: '100%',
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
} as const;

const namespaceLabelSx = { color: 'text.secondary' } as const;

const eventsContainerSx = {
  height: 'clamp(300px, 40vh, 600px)',
  overflow: 'auto',
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 1,
} as const;
import {
  PodStatCard,
  DeploymentStatCard,
  StatefulSetStatCard,
  DaemonSetStatCard,
  JobStatCard,
  CronJobStatCard,
} from './components/WorkloadStatCards';
import EventsTable from './EventsTable';

/** Shape of the connection metadata returned by the runtime for Kubernetes clusters. */
type ConnectionData = {
  server_url?: string;
  k8s_version?: string;
  k8s_platform?: string;
  node_count?: number;
  api_groups?: number;
  last_checked?: string;
};

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
  const widgetEP = useExtensionPoint<{ pluginID: string; connectionID: string }>(
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
    <Box
      sx={pageSx}
    >
      <Stack gap={1.5}>
        {/* Cluster info + health status */}
        <ClusterInfoCard
          // Connection.data is Record<string, any> from the runtime; cast to the expected shape
          data={connection.data?.data as ConnectionData | undefined}
          loading={connection.isLoading}
          nodes={allNodes}
          pods={allPods}
          events={allEvents}
        />

        {/* Namespace filter */}
        <Stack direction="row" alignItems="center" gap={1}>
          <Text size="sm" sx={namespaceLabelSx}>
            Namespace:
          </Text>
          <NamespaceSelect connectionID={id} selected={namespaces} setNamespaces={setNamespaces} />
        </Stack>

        {/* Workload summary cards — each owns its own useResources hook */}
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <PodStatCard connectionID={id} namespaces={namespaces} onClick={goToPods} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <DeploymentStatCard
              connectionID={id}
              namespaces={namespaces}
              onClick={goToDeployments}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <StatefulSetStatCard
              connectionID={id}
              namespaces={namespaces}
              onClick={goToStatefulSets}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <DaemonSetStatCard connectionID={id} namespaces={namespaces} onClick={goToDaemonSets} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <JobStatCard connectionID={id} namespaces={namespaces} onClick={goToJobs} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <CronJobStatCard connectionID={id} namespaces={namespaces} onClick={goToCronJobs} />
          </Grid>
        </Grid>

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
          <Grid container spacing={1.5}>
            {widgets.map((w) => {
              const Component = w.component as unknown as React.FC<{
                pluginID: string;
                connectionID: string;
              }>;
              return (
                <Grid key={w.id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Component pluginID="kubernetes" connectionID={id} />
                </Grid>
              );
            })}
          </Grid>
        )}

        {/* Recent events — responsive height, scrolls independently */}
        <Stack gap={0.75}>
          <Text weight="semibold" size="sm">
            Recent Events ({allEvents.length})
          </Text>
          <Box
            sx={eventsContainerSx}
          >
            <EventsTable events={allEvents} loading={events.isLoading} connectionID={id} />
          </Box>
        </Stack>
      </Stack>
    </Box>
  );
};

export default ClusterDashboardOverviewPage;
