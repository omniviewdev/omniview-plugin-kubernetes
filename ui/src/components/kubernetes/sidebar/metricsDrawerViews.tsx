import type { DrawerContext } from '@omniviewdev/runtime';
import PodMetricsSection, { type MetricSidebarProps } from './Pod/PodMetricsSection';
import NodeMetricsSection from './NodeMetricsSection';

/** Preserve the host target and body; provider selection never rewrites ownership. */
export function metricSidebarProps<T>(ctx: DrawerContext<T>): MetricSidebarProps {
  const reference = ctx.resource?.reference;
  return {
    connectionID: ctx.resource?.route.connection ?? '',
    resourceKey: reference?.address.type ?? '',
    resourceID: reference?.address.id ?? '',
    resourceNamespace: reference?.address.scope.find(part => part.dimension === 'namespace')?.value,
    resourceData: ctx.resource?.record?.record.body,
    reference,
    route: ctx.resource?.route,
  };
}

export function renderPodMetrics<T>(ctx: DrawerContext<T>) {
  return <PodMetricsSection {...metricSidebarProps(ctx)} />;
}

export function renderNodeMetrics<T>(ctx: DrawerContext<T>) {
  return <NodeMetricsSection {...metricSidebarProps(ctx)} />;
}
