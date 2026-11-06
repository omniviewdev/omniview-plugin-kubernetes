import type { DrawerComponentView, DrawerContext } from '@omniviewdev/runtime';
import { LuActivity } from 'react-icons/lu';
import ResourceMetricPanels from '../../../../ResourceMetricPanels';

function ResourceMetricsPage({ ctx }: { ctx: DrawerContext<Record<string, unknown>> }) {
  return <ResourceMetricPanels connectionID={ctx.resource?.route.connection ?? ''}
    defaultMetricIDs={['kubernetes.pod.cpu.usage', 'kubernetes.pod.memory.working_set', 'kubernetes.node.cpu.usage', 'kubernetes.node.memory.working_set']}
    resourceKey={ctx.resource?.reference.address.type ?? ''}
    resourceID={ctx.resource?.reference.address.id ?? ''}
    reference={ctx.resource?.reference} route={ctx.resource?.route} />;
}

// eslint-disable-next-line react-refresh/only-export-components
export function createMetricsView(): DrawerComponentView<Record<string, unknown>> {
  return { title: 'Metrics', icon: <LuActivity />, component: ctx => <ResourceMetricsPage ctx={ctx} /> };
}

export default ResourceMetricsPage;
