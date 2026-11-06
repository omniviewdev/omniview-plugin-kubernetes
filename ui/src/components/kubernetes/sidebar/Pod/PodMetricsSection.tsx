import { useMetricOwnerConnection, type DrawerContext } from '@omniviewdev/runtime';
import type { Pod } from 'kubernetes-types/core/v1';

import ResourceMetricPanels from '../../../shared/ResourceMetricPanels';

import { podMetricBound } from './podMetricBound';

import { PLUGIN_ID } from '@/pluginId';

/** Render only metrics for the admitted, focused Pod incarnation. */
export function PodMetricsView({ ctx }: { ctx: DrawerContext<unknown> }) {
  const pod = ctx.data as Pod | undefined;
  const connection = useMetricOwnerConnection(PLUGIN_ID, ctx.resource?.route.connection ?? '');
  return <ResourceMetricPanels
    defaultMetricIDs={['kubernetes.pod.cpu.usage', 'kubernetes.pod.memory.working_set']}
    connectionID={ctx.resource?.route.connection ?? ''}
    resourceKey={ctx.resource?.reference.address.type ?? 'k8s:/pods'}
    resourceID={ctx.resource?.reference.address.id ?? ''}
    reference={ctx.resource?.reference}
    route={ctx.resource?.route}
    identityLabels={(result, publicScope) => {
      const reference = result?.resourceReference ?? ctx.resource?.reference;
      const cluster = publicScope.cluster || connection?.name;
      const namespace = reference?.address.scope.find(entry => entry.dimension === 'namespace')?.value ?? pod?.metadata?.namespace;
      const name = reference?.address.id ?? pod?.metadata?.name;
      return {
        ...(cluster ? { cluster } : {}),
        ...(namespace ? { namespace } : {}),
        ...(name ? { pod: name } : {}),
        ...(pod?.spec?.nodeName ? { node: pod.spec.nodeName } : {}),
      };
    }}
    capacities={{
      'kubernetes.pod.cpu.usage': { request: podMetricBound(pod, 'cpu', 'requests'), limit: podMetricBound(pod, 'cpu', 'limits') },
      'kubernetes.pod.memory.working_set': { request: podMetricBound(pod, 'memory', 'requests'), limit: podMetricBound(pod, 'memory', 'limits') },
    }}
  />;
}
