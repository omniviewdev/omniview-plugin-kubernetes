import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useResourceSetMetrics, type HostRecord, type MetricResource, type ResourceSetQueryRequest, type ResourceMetricResult } from '@omniviewdev/runtime';
import { MetricClient } from '@omniviewdev/runtime/api';
import { PLUGIN_ID } from '@/pluginId';
import { useDocumentVisibility } from './useDocumentVisibility';

export type PodMetricEntry = { cpu?: ResourceMetricResult; memory?: ResourceMetricResult };
export type PodMetricsMap = Map<string, PodMetricEntry>;
export const POD_CURRENT_METRICS = ['cpu_usage', 'memory_usage'];
const ZERO_TIME = '0001-01-01T00:00:00Z';

/** Only host-issued identity and route cross the metric admission boundary. */
export function podMetricResource(record: HostRecord): MetricResource {
  const reference = record.record.reference;
  return {
    token: JSON.stringify(reference), reference, route: record.route,
    resource_key: reference.address.type, resource_id: reference.address.id,
    resource_namespace: reference.address.scope.find((scope) => scope.dimension === 'namespace')?.value ?? '',
  } as MetricResource;
}

export function usePodResourceSetMetrics(opts: {
  connectionID: string; resources: MetricResource[]; metricIDs?: string[];
  shape?: ResourceSetQueryRequest['shape']; startTime?: string; endTime?: string; step?: number;
  enabled?: boolean; refreshInterval?: number; bindingID?: string;
}) {
  const visible = useDocumentVisibility();
  const enabled = opts.enabled !== false && visible && !!opts.connectionID && opts.resources.length > 0;
  const bindings = useQuery({
    queryKey: ['metric', 'bindings', PLUGIN_ID, opts.connectionID],
    queryFn: () => MetricClient.GetMetricBindings(PLUGIN_ID, opts.connectionID), enabled,
  });
  const binding = bindings.data?.find((item) => item.signal === 'metrics' && (opts.bindingID === undefined || item.id === opts.bindingID));
  const missingBinding = !!opts.bindingID && opts.bindingID !== 'native' && bindings.isSuccess && !binding;
  const request = bindings.isSuccess && !missingBinding ? {
    resource_plugin_id: PLUGIN_ID, resource_connection_id: opts.connectionID,
    binding_id: opts.bindingID === '' || opts.bindingID === 'native' ? 'native' : binding?.id ?? '',
    source: binding?.source ?? { plugin_id: '', connection_id: '', datasource_uid: '', datasource_kind: '' },
    resources: opts.resources, metric_ids: opts.metricIDs ?? POD_CURRENT_METRICS,
    definitions: [], public_scope: {}, mapping_revision: binding?.revision ?? '',
    shape: opts.shape ?? 0, start_time: opts.startTime ?? ZERO_TIME,
    end_time: opts.endTime ?? ZERO_TIME, step: opts.step ?? 0,
  } as ResourceSetQueryRequest : undefined;
  const query = useResourceSetMetrics(request, { enabled, refreshInterval: opts.refreshInterval ?? 30_000 });
  const data = query.data && binding ? { ...query.data, results: query.data.results.filter((result) => result.provenance.binding_id === binding.id && !result.provenance.native || binding.policy === 'supplement' && result.provenance.native) } : query.data;
  return { ...query, data, error: bindings.error ?? (missingBinding ? new Error('Selected metric binding is unavailable') : query.error),
    isLoading: enabled && (bindings.isLoading || query.isLoading) };
}

export function podMetricsMap(resources: MetricResource[], results: ResourceMetricResult[]): PodMetricsMap {
  const keys = new Map(resources.map((resource) => [resource.token, `${resource.resource_namespace}/${resource.resource_id}`]));
  const metrics = new Map<string, PodMetricEntry>();
  for (const result of results) {
    const key = keys.get(result.resource_token);
    if (!key) continue;
    const entry = metrics.get(key) ?? {};
    const field = result.metric_id === 'cpu_usage' ? 'cpu' : result.metric_id === 'memory_usage' ? 'memory' : undefined;
    if (!field) continue;
    const previous = entry[field];
    if (previous && previous.provenance.native !== result.provenance.native) {
      // A configured external result wins even when unavailable; never hide its failure.
      if (!previous.provenance.native) continue;
      entry[field] = undefined;
    }
    // These cells display pod totals, not one arbitrary dimensional series.
    entry[field] = entry[field] || Object.keys(result.dimensions ?? {}).length > 0
      ? { ...result, status: 'ambiguous', value: undefined,
        warnings: [...(result.warnings ?? []), 'Pod total unavailable: multiple or dimensional metric results require an explicit aggregate mapping.'] } as ResourceMetricResult
      : result;
    metrics.set(key, entry);
  }
  return metrics;
}

export function usePodMetricsBatch(opts: {
  connectionID: string; records: readonly HostRecord[]; refreshInterval?: number; enabled?: boolean;
}) {
  const resources = useMemo(() => opts.records.map(podMetricResource), [opts.records]);
  const query = usePodResourceSetMetrics({ ...opts, resources });
  const metricsMap = useMemo(() => podMetricsMap(resources, query.data?.results ?? []), [resources, query.data]);
  return { ...query, metricsMap };
}
