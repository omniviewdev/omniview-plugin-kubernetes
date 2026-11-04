import PodMetricsSection, { type MetricSidebarProps } from './Pod/PodMetricsSection';

const NODE_METRICS = ['cpu_usage', 'cpu_capacity', 'memory_usage', 'memory_capacity'];

export default function NodeMetricsSection(props: MetricSidebarProps) {
  return <PodMetricsSection {...props} nativeMetricIDs={NODE_METRICS} />;
}
