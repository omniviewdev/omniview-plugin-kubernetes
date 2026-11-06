import type { DrawerContext } from '@omniviewdev/runtime';
import type { Pod } from 'kubernetes-types/core/v1';
import { podMetricBound } from './podMetricBound';
import ResourceMetricPanels from '../../../shared/ResourceMetricPanels';

/** Render only metrics for the admitted, focused Pod incarnation. */
export function PodMetricsView({ ctx }: { ctx: DrawerContext<unknown> }) {
  const pod = ctx.data as Pod | undefined;
  return <ResourceMetricPanels
    defaultMetricIDs={['kubernetes.pod.cpu.usage', 'kubernetes.pod.memory.working_set']}
    connectionID={ctx.resource?.route.connection ?? ''}
    resourceKey={ctx.resource?.reference.address.type ?? 'k8s:/pods'}
    resourceID={ctx.resource?.reference.address.id ?? ''}
    reference={ctx.resource?.reference}
    route={ctx.resource?.route}
    capacities={{
      'kubernetes.pod.cpu.usage': { request: podMetricBound(pod, 'cpu', 'requests'), limit: podMetricBound(pod, 'cpu', 'limits') },
      'kubernetes.pod.memory.working_set': { request: podMetricBound(pod, 'memory', 'requests'), limit: podMetricBound(pod, 'memory', 'limits') },
    }}
  />;
}
