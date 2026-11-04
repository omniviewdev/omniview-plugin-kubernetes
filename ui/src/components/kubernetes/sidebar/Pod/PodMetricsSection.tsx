import { useMemo, useState } from 'react';
import { Spinner, Stack, Text } from '@omniviewdev/base-ui';
import { useMetricProvidersForResource, type MetricResource, type ResourceReference, type AccessRoute, type Value } from '@omniviewdev/runtime';
import { MetricClient } from '@omniviewdev/runtime/api';
import { useQuery } from '@tanstack/react-query';
import { MetricsPanel } from '../../../shared/charts';
import type { ChartTimeRange } from '../../../shared/charts';
import { PLUGIN_ID } from '@/pluginId';
import { metricResultDisplay, metricResourceToken } from '../metricPresentation';
import { usePodResourceSetMetrics } from '@/hooks/usePodMetricsBatch';

const UNIT_LABELS: Record<number, string> = {
  0: '', 1: 'B', 2: 'KB', 3: 'MB', 4: 'GB', 5: '%', 6: 'ms',
  7: 's', 8: 'count', 9: 'ops/s', 10: 'B/s', 11: 'millicores', 12: 'cores',
};

export interface MetricSidebarProps {
  connectionID: string;
  resourceKey: string;
  resourceID: string;
  resourceNamespace?: string;
  resourceData?: Value;
  reference?: ResourceReference;
  route?: AccessRoute;
  nativeMetricIDs?: string[];
}

/** Resource ownership always comes from the host target, never the provider source. */
export default function PodMetricsSection(props: MetricSidebarProps) {
  const { connectionID, resourceKey, resourceID, reference, route } = props;
  const [bindingID, setBindingID] = useState('');
  const [additional, setAdditional] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<ChartTimeRange>(() => ({ from: new Date(Date.now() - 3600000), to: new Date() }));
  const enabled = Boolean(connectionID && resourceID && reference && route);
  const bindings = useQuery({
    queryKey: ['metric', 'bindings', PLUGIN_ID, connectionID],
    queryFn: () => MetricClient.GetMetricBindings(PLUGIN_ID, connectionID),
    enabled,
  });
  const definitions = useQuery({ queryKey: ['metric', 'definitions'], queryFn: () => MetricClient.GetMetricDefinitions(), enabled });
  const nativeProviders = useMetricProvidersForResource(resourceKey);
  const sources = (bindings.data ?? []).filter(binding => binding.signal === 'metrics');
  const selectedBinding = sources.find(binding => binding.id === bindingID);
  const nativeMetrics = (nativeProviders.data ?? [])
    .filter(provider => provider.plugin_id === PLUGIN_ID)
    .flatMap(provider => (provider.handlers ?? []).filter(handler => handler.resource === resourceKey).flatMap(handler => handler.metrics ?? []));
  const available = selectedBinding
    ? (definitions.data ?? []).filter(definition => !definition.native && definition.resource_keys?.includes(resourceKey))
    : nativeMetrics;
  const baseIDs = props.nativeMetricIDs ?? ['cpu_usage', 'memory_usage'];
  const metricIDs = selectedBinding
    ? available.filter(definition => additional.includes(definition.id) || baseIDs.includes(definition.id)).map(definition => definition.id)
    : [...baseIDs, ...additional.filter(id => !baseIDs.includes(id) && available.some(definition => definition.id === id))];
  const token = metricResourceToken(reference, resourceKey, props.resourceNamespace ?? '', resourceID);
  const resources = useMemo(() => enabled ? [{
    token, resource_key: resourceKey, resource_id: resourceID,
    resource_namespace: reference?.address.scope.find(scope => scope.dimension === 'namespace')?.value ?? props.resourceNamespace ?? '',
    reference, route,
  } as MetricResource] : [], [enabled, token, resourceKey, resourceID, props.resourceNamespace, reference, route]);
  const current = usePodResourceSetMetrics({ connectionID, resources, bindingID: bindingID || 'native', metricIDs, enabled: enabled && metricIDs.length > 0 });
  const seriesIDs = metricIDs.filter(id => additional.includes(id) && available.some(definition => definition.id === id && definition.supported_shapes?.includes(1)));
  const history = usePodResourceSetMetrics({
    connectionID, resources, bindingID: bindingID || 'native', metricIDs: seriesIDs, shape: 1,
    startTime: timeRange.from.toISOString(), endTime: timeRange.to.toISOString(), step: 30000000000,
    enabled: enabled && seriesIDs.length > 0,
  });
  const results = (current.data?.results ?? []).filter(result => result.resource_token === token);
  const error = bindings.error ?? (selectedBinding ? definitions.error : nativeProviders.error) ?? current.error ?? history.error;
  return <Stack direction="column" spacing={2}>
    <Text weight="semibold">Metrics</Text>
    <label>Metric source <select aria-label="Metric source" value={bindingID} onChange={event => { setBindingID(event.target.value); setAdditional([]); }}>
      <option value="">Native Kubernetes metrics</option>
      {sources.map(binding => <option key={binding.id} value={binding.id}>{binding.source.plugin_id} · {binding.source.connection_id} · {binding.source.datasource_uid} ({binding.policy})</option>)}
    </select></label>
    <fieldset><legend>Additional metrics</legend>
      {available.map(definition => <label key={definition.id} style={{ display: 'block' }}>
        <input type="checkbox" checked={additional.includes(definition.id)} onChange={event => setAdditional(ids => event.target.checked ? [...ids, definition.id] : ids.filter(id => id !== definition.id))} />{definition.name}
      </label>)}
      {!available.length && <Text size="xs">No applicable metric definitions.</Text>}
    </fieldset>
    {!enabled && <Text size="xs">Canonical resource target unavailable.</Text>}
    {error && <Text role="alert" tone="danger">{error instanceof Error ? error.message : 'Metrics request failed'}</Text>}
    {(current.isLoading || bindings.isLoading || (selectedBinding ? definitions.isLoading : nativeProviders.isLoading)) && <Spinner size="sm" />}
    {enabled && !current.isLoading && !error && !results.length && <Text size="xs">No measurements returned. This does not mean zero usage.</Text>}
    {metricIDs.map(id => {
      const matches = results.filter(result => result.metric_id === id);
      const definition = available.find(definition => definition.id === id);
      return <div key={id}><Text size="sm">{available.find(definition => definition.id === id)?.name ?? id}</Text>
        {!matches.length && !current.isLoading && <Text size="xs">Not reported</Text>}
        {matches.map((result, index) => <div key={index}>
          <Text size="sm">{metricResultDisplay(result)} {definition ? UNIT_LABELS[definition.unit] : ''}</Text>
          <Text size="xs" tone="muted">{result.provenance.native ? 'Native Kubernetes' : `${result.provenance.source.plugin_id} · ${result.provenance.source.connection_id} · ${result.provenance.source.datasource_uid}`} · {result.status}{result.mapping_revision ? ` · revision ${result.mapping_revision}` : ''}</Text>
          {Object.entries(result.dimensions ?? {}).map(([key, value]) => <Text key={key} size="xs">{key}: {value}</Text>)}
          {Object.entries(result.value?.current_value?.labels ?? {}).map(([key, value]) => <Text key={`label-${key}`} size="xs">{key}: {value}</Text>)}
          {result.warnings?.map((warning, index) => <Text key={index} size="xs">{warning}</Text>)}
        </div>)}
      </div>;
    })}
    {current.data?.warnings?.map((warning, index) => <Text key={index} size="xs">{warning}</Text>)}
    {(history.data?.results ?? []).filter(result => result.resource_token === token).map((result, index) => {
      const series = result.value?.time_series;
      const identity = JSON.stringify(result.dimensions ?? {});
      const provenance = result.provenance.native ? 'Native Kubernetes' : `${result.provenance.source.plugin_id} · ${result.provenance.source.connection_id} · ${result.provenance.source.datasource_uid}`;
      return <div key={`${result.metric_id}-${identity}-${index}`}>
        <Text size="xs" tone="muted">{provenance} · {result.status}{result.mapping_revision ? ` · revision ${result.mapping_revision}` : ''}</Text>
        {Object.entries(result.dimensions ?? {}).map(([key, value]) => <Text key={`dimension-${key}`} size="xs">{key}: {value}</Text>)}
        {Object.entries(series?.labels ?? {}).map(([key, value]) => <Text key={`label-${key}`} size="xs">{key}: {value}</Text>)}
        {result.warnings?.map((warning, warningIndex) => <Text key={warningIndex} size="xs">{warning}</Text>)}
        {!series?.data_points?.length || !['ok', 'partial', 'stale'].includes(result.status)
          ? <Text size="xs">{result.metric_id}: No history measurements</Text>
          : <MetricsPanel title={available.find(definition => definition.id === result.metric_id)?.name ?? result.metric_id} series={[{ id: `${result.metric_id}-${identity}`, label: `${result.metric_id} ${identity}`, data: series.data_points.filter(point => Number.isFinite(point.value)).map(point => ({ timestamp: new Date(point.timestamp).getTime(), value: point.value })) }]} timeRange={timeRange} onTimeRangeChange={setTimeRange} variant="compact" height={140} loading={history.isFetching} />}
      </div>;
    })}
  </Stack>;
}
