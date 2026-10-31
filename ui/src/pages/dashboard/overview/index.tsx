import { Stack, Text } from '@omniviewdev/base-ui';
import {
  useConnection,
  useExtensionPoint,
  usePluginRouter,
} from '@omniviewdev/runtime';
import { useKubernetesResources } from '../../../hooks/useKubernetesResources';
import type { Pod, Node as K8sNode, Event as K8sEvent } from 'kubernetes-types/core/v1';
import React from 'react';
import { useParams } from 'react-router';

import { PLUGIN_ID } from '@/pluginId';

import type { ChartTimeRange } from '../../../components/shared/charts';
import NamespaceSelect from '../../../components/tables/NamespaceSelect';
import { useClusterPreferences } from '../../../hooks/useClusterPreferences';
import { CollectionStatus } from '../../../components/shared/CollectionStatus';
import { destinationPath } from '../../../search/navigation';

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
  minHeight: 0,
};

// EventsTable scrolls its own list, so the frame clips instead of adding a
// second set of scrollbars.
const eventsContainerStyle: React.CSSProperties = {
  height: 'clamp(300px, 40vh, 600px)',
  overflow: 'hidden',
  border: '1px solid var(--ov-color-border-default)',
  borderRadius: 4,
};

/** Keep cards wide enough for source controls, wrapping into rows as needed. */
const workloadGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
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
      navigate(destinationPath(id, resourceKey));
    },
    [navigate, id],
  );

  // Stable onClick callbacks per resource type
  const goToPods = React.useCallback(() => goToResource('k8s:/pods'), [goToResource]);
  const goToDeployments = React.useCallback(
    () => goToResource('k8s:apps/deployments'),
    [goToResource],
  );
  const goToStatefulSets = React.useCallback(
    () => goToResource('k8s:apps/statefulsets'),
    [goToResource],
  );
  const goToDaemonSets = React.useCallback(() => goToResource('k8s:apps/daemonsets'), [goToResource]);
  const goToJobs = React.useCallback(() => goToResource('k8s:batch/jobs'), [goToResource]);
  const goToCronJobs = React.useCallback(() => goToResource('k8s:batch/cronjobs'), [goToResource]);

  const { connection } = useConnection({ pluginID: PLUGIN_ID, connectionID: id });
  const { connectionOverrides } = useClusterPreferences(PLUGIN_ID);
  const metricConfig = connectionOverrides[id]?.metricConfig;

  // Own Pod ingestion once; health and workload counts share the collection.
  const pods = useKubernetesResources<Pod>({ connectionID: id, resourceType: 'k8s:/pods', namespaces });
  const nodes = useKubernetesResources<K8sNode>({ connectionID: id, resourceType: 'k8s:/nodes' });
  const events = useKubernetesResources<K8sEvent>({ connectionID: id, resourceType: 'k8s:/events', namespaces });

  // --- Extension point for dashboard widgets ---
  const widgetEP = useExtensionPoint<React.FC<{ pluginID: string; connectionID: string }>>(
    'omniview/dashboard/widget',
  );
  const widgets = widgetEP?.list() ?? [];

  // --- Filtered data for health banner and events ---
  const allPods = React.useMemo(
    () => filterByNamespace(pods.bodies ?? [], namespaces),
    [pods.bodies, namespaces],
  );
  const allNodes = nodes.bodies;
  const allEvents = React.useMemo(
    () => filterByNamespace(events.bodies ?? [], namespaces),
    [events.bodies, namespaces],
  );

  return (
    <div style={pageStyle}>
      <Stack direction="column" spacing={3} style={{ flexShrink: 0, minWidth: 0 }}>
        {/* Cluster info + health status */}
        <ClusterInfoCard
          connectionID={id}
          loading={connection.isLoading}
          nodes={allNodes}
          pods={allPods}
          events={allEvents}
        />
        <CollectionStatus {...pods} label="Pods" />
        <CollectionStatus {...nodes} label="Nodes" />

        {/* Namespace filter */}
        <Stack direction="row" align="center" spacing={2} style={{ flexWrap: 'wrap', minWidth: 0 }}>
          <Text size="sm" tone="muted">
            Namespace:
          </Text>
          <NamespaceSelect connectionID={id} selected={namespaces} setNamespaces={setNamespaces} />
        </Stack>

        {/* Pods share the health data; other workload cards own their collections. */}
        <div style={workloadGridStyle}>
          <PodStatCard pods={allPods} loading={pods.isLoading} onClick={goToPods} />
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
                  <Component pluginID={PLUGIN_ID} connectionID={id} />
                </div>
              );
            })}
          </div>
        )}

        {/* Recent events — responsive height, scrolls independently */}
        <Stack direction="column" spacing={1} style={{ gap: 6 }}>
          <Text weight="semibold" size="sm">
            Events ({allEvents.length})
          </Text>
          <CollectionStatus {...events} label="Events" />
          <div style={eventsContainerStyle}>
            <EventsTable events={allEvents} loading={events.isLoading} connectionID={id} namespaceScope={JSON.stringify(namespaces)} />
          </div>
        </Stack>
      </Stack>
    </div>
  );
};

export default ClusterDashboardOverviewPage;
