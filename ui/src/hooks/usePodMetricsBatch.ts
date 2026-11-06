import { useMetricObservation, type PreparedMetricResult, type ResourceMetricTarget } from '@omniviewdev/runtime';

import { PLUGIN_ID } from '@/pluginId';

export const POD_CPU_METRIC = 'kubernetes.pod.cpu.usage';
export const POD_MEMORY_METRIC = 'kubernetes.pod.memory.working_set';
export type PodMetricTarget = ResourceMetricTarget;
export type PodMetricsMap = ReadonlyMap<string, ReadonlyMap<string, PreparedMetricResult>>;

/** One host-owned current observation for the mounted virtual rows; never fetches whole-cluster metrics. */
export function usePodMetricsBatch(opts: {
  connectionID: string;
  targets: PodMetricTarget[];
  metricIDs: string[];
  enabled: boolean;
}) {
  return useMetricObservation({
    ownerPluginID: PLUGIN_ID,
    ownerConnectionID: opts.connectionID,
    resourceKey: 'k8s:/pods',
    targets: opts.targets,
    metricIDs: opts.metricIDs,
    shape: 'current',
    intervalMs: 30_000,
    enabled: opts.enabled && opts.targets.length > 0 && !!opts.connectionID,
  });
}
