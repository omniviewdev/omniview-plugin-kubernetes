import { useEffect, useMemo, useState } from 'react';
import { Button, IconButton, Popover, SearchInput, Spinner, Text } from '@omniviewdev/base-ui';
import { useMetricProvidersForResource, type MetricResource, type ResourceReference, type AccessRoute, type Value } from '@omniviewdev/runtime';
import { MetricClient } from '@omniviewdev/runtime/api';
import { useQuery } from '@tanstack/react-query';
import { TimeSeriesChart } from '../../../shared/charts';
import { formatBytes, formatDuration, formatNumber, formatPercent, formatRate } from '../../../shared/charts/formatters';
import SimpleSelect from '../../../connections/SimpleSelect';
import { LuChevronRight, LuCode, LuDatabase, LuPlus, LuRefreshCw, LuX } from 'react-icons/lu';
import styles from './PodMetricsSection.module.css';
import type { ChartTimeRange } from '../../../shared/charts';
import { PLUGIN_ID } from '@/pluginId';
import { metricResultDisplay, metricResourceToken } from '../metricPresentation';
import { usePodResourceSetMetrics } from '@/hooks/usePodMetricsBatch';
import { useDocumentVisibility } from '@/hooks/useDocumentVisibility';

const HISTORY_STEP_MS = 30_000;
function alignedHistoryEnd() {
  return Math.floor(Date.now() / HISTORY_STEP_MS) * HISTORY_STEP_MS;
}

const UNIT_LABELS: Record<number, string> = {
  0: '', 1: 'B', 2: 'KB', 3: 'MB', 4: 'GB', 5: '%', 6: 'ms',
  7: 's', 8: 'count', 9: 'ops/s', 10: 'B/s', 11: 'm', 12: 'cores',
};

function formatMeasurement(value: number, unit: number): string {
  if (unit === 1) return formatBytes(value).replace(/([KMGT])iB$/, '$1i');
  if (unit === 10) return `${formatBytes(value)}/s`;
  if (unit === 5) return formatPercent(value);
  if (unit === 6) return formatDuration(value);
  if (unit === 9) return formatRate(value, 'ops/s');
  return formatNumber(value, UNIT_LABELS[unit]);
}

function displayMeasurement(result: Parameters<typeof metricResultDisplay>[0], unit: number): { value: string; unit: string } {
  const display = metricResultDisplay(result);
  const value = result.value?.current_value?.value;
  if (value == null || !Number.isFinite(value) || !['ok', 'partial', 'stale'].includes(result.status)) return { value: display, unit: '' };
  const formatted = formatMeasurement(value, unit);
  const separator = formatted.lastIndexOf(' ');
  return {
    value: separator < 0 ? formatted : formatted.slice(0, separator),
    unit: `${separator < 0 ? '' : formatted.slice(separator + 1)}${display.endsWith('(stale)') ? ' (stale)' : ''}`,
  };
}

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
  const [hidden, setHidden] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [browserOpen, setBrowserOpen] = useState(false);
  const [duration, setDuration] = useState('3600000');
  const [rangeEnd, setRangeEnd] = useState(alignedHistoryEnd);
  const timeRange = useMemo<ChartTimeRange>(() => ({ from: new Date(rangeEnd - Number(duration)), to: new Date(rangeEnd) }), [rangeEnd, duration]);
  const visible = useDocumentVisibility();
  const enabled = Boolean(connectionID && resourceID && reference && route);
  const bindings = useQuery({
    queryKey: ['metric', 'bindings', PLUGIN_ID, connectionID],
    queryFn: () => MetricClient.GetMetricBindings(PLUGIN_ID, connectionID),
    enabled,
  });
  const definitions = useQuery({ queryKey: ['metric', 'definitions'], queryFn: () => MetricClient.GetMetricDefinitions(), enabled });
  const nativeProviders = useMetricProvidersForResource(resourceKey);
  const sources = (bindings.data ?? []).filter(binding => binding.signal === 'metrics');
  const selectedBinding = sources.find(binding => bindingID !== 'native' && (!bindingID || binding.id === bindingID));
  const nativeMetrics = (nativeProviders.data ?? [])
    .filter(provider => provider.plugin_id === PLUGIN_ID)
    .flatMap(provider => (provider.handlers ?? []).filter(handler => handler.resource === resourceKey).flatMap(handler => handler.metrics ?? []));
  const externalMetrics = (definitions.data ?? []).filter(definition => !definition.native && definition.resource_keys?.includes(resourceKey));
  const needsNative = !selectedBinding || selectedBinding.policy === 'supplement';
  const available = !selectedBinding ? nativeMetrics : selectedBinding.policy === 'supplement'
    ? [...externalMetrics, ...nativeMetrics.filter(metric => !externalMetrics.some(definition => definition.id === metric.id))]
    : externalMetrics;
  const baseIDs = props.nativeMetricIDs ?? ['cpu_usage', 'memory_usage'];
  const selectedIDs = [...new Set([...baseIDs.filter(id => !hidden.includes(id)), ...additional])];
  // Shape admission uses both supplemental lanes before deduplicating IDs.
  const descriptors = !selectedBinding ? nativeMetrics : selectedBinding.policy === 'supplement'
    ? [...externalMetrics, ...nativeMetrics] : externalMetrics;
  const currentBaseIDs = [...new Set(descriptors
    .filter(definition => baseIDs.includes(definition.id) && definition.supported_shapes?.includes(0))
    .map(definition => definition.id))];
  const additionalCurrentIDs = [...new Set(descriptors
    .filter(definition => !baseIDs.includes(definition.id) && additional.includes(definition.id) && definition.supported_shapes?.includes(0))
    .map(definition => definition.id))];
  const token = metricResourceToken(reference, resourceKey, props.resourceNamespace ?? '', resourceID);
  const resources = useMemo(() => enabled ? [{
    token, resource_key: resourceKey, resource_id: resourceID,
    resource_namespace: reference?.address.scope.find(scope => scope.dimension === 'namespace')?.value ?? props.resourceNamespace ?? '',
    reference, route,
  } as MetricResource] : [], [enabled, token, resourceKey, resourceID, props.resourceNamespace, reference, route]);
  // Keep the base lane table-compatible when additional metrics change.
  const current = usePodResourceSetMetrics({ connectionID, resources, bindingID: bindingID || undefined, metricIDs: currentBaseIDs, enabled: enabled && currentBaseIDs.length > 0 });
  const additionalCurrent = usePodResourceSetMetrics({ connectionID, resources, bindingID: bindingID || undefined, metricIDs: additionalCurrentIDs, enabled: enabled && additionalCurrentIDs.length > 0 });
  const baseSeriesIDs = [...new Set(descriptors
    .filter(definition => baseIDs.includes(definition.id) && selectedIDs.includes(definition.id) && definition.supported_shapes?.includes(1))
    .map(definition => definition.id))];
  const additionalSeriesIDs = [...new Set(descriptors
    .filter(definition => !baseIDs.includes(definition.id) && additional.includes(definition.id) && definition.supported_shapes?.includes(1))
    .map(definition => definition.id))];
  const hasHistory = baseSeriesIDs.length > 0 || additionalSeriesIDs.length > 0;
  // Catch up before admission after a hidden view or late descriptor load.
  const historyEnabled = enabled && visible && rangeEnd === alignedHistoryEnd();
  useEffect(() => {
    if (!enabled || !visible || !hasHistory) return;
    let timer = 0;
    const advance = () => {
      setRangeEnd(alignedHistoryEnd());
      timer = window.setTimeout(advance, HISTORY_STEP_MS - Date.now() % HISTORY_STEP_MS);
    };
    advance();
    return () => window.clearTimeout(timer);
  }, [enabled, visible, hasHistory]);
  const history = usePodResourceSetMetrics({
    connectionID, resources, bindingID: bindingID || undefined, metricIDs: baseSeriesIDs, shape: 1,
    startTime: timeRange.from.toISOString(), endTime: timeRange.to.toISOString(), step: 30000000000,
    enabled: historyEnabled && baseSeriesIDs.length > 0, refreshInterval: 0,
  });
  const additionalHistory = usePodResourceSetMetrics({
    connectionID, resources, bindingID: bindingID || undefined, metricIDs: additionalSeriesIDs, shape: 1,
    startTime: timeRange.from.toISOString(), endTime: timeRange.to.toISOString(), step: 30000000000,
    enabled: historyEnabled && additionalSeriesIDs.length > 0, refreshInterval: 0,
  });
  const results = [...(current.data?.results ?? []), ...(additionalCurrent.data?.results ?? [])].filter(result => result.resource_token === token);
  const currentLoading = current.isLoading || additionalCurrent.isLoading;
  const error = bindings.error ?? (selectedBinding ? definitions.error : undefined) ?? (needsNative ? nativeProviders.error : undefined) ?? current.error ?? additionalCurrent.error ?? history.error ?? additionalHistory.error;
  const historyResults = [...(history.data?.results ?? []), ...(additionalHistory.data?.results ?? [])].filter(result => result.resource_token === token);
  const palette = ['#81a6ff', '#b49bfa', '#73bfaa', '#ffb86c'];
  const selected = available.filter((definition, index) => selectedIDs.includes(definition.id) && available.findIndex(item => item.id === definition.id) === index);
  // Native descriptors expose presentation metadata, not external query templates.
  const queryDefinitions = selectedBinding ? externalMetrics.filter(definition =>
    selectedIDs.includes(definition.id) && Boolean(selectedBinding.overrides?.find(item => item.metric_id === definition.id)?.query ?? definition.query),
  ) : [];
  const providerID = selectedBinding?.source.plugin_id ?? '';
  const providerConnections = useQuery({
    queryKey: ['metric', 'provider-connections', providerID],
    queryFn: () => MetricClient.GetProviderConnections(providerID),
    enabled: enabled && Boolean(providerID),
  });
  const providerDataSources = useQuery({
    queryKey: ['metric', 'datasources', providerID, selectedBinding?.source.connection_id],
    queryFn: () => MetricClient.GetDataSources(providerID, selectedBinding!.source.connection_id),
    enabled: enabled && Boolean(selectedBinding),
  });
  const sourceLabel = selectedBinding
    ? `${providerConnections.data?.find(connection => connection.id === selectedBinding.source.connection_id)?.name || selectedBinding.source.connection_id} / ${providerDataSources.data?.find(datasource => datasource.uid === selectedBinding.source.datasource_uid)?.name || selectedBinding.source.datasource_uid}`
    : 'Native Kubernetes';
  const refresh = () => {
    const nextEnd = alignedHistoryEnd();
    if (nextEnd === rangeEnd) {
      if (baseSeriesIDs.length) history.refetch();
      if (additionalSeriesIDs.length) additionalHistory.refetch();
    } else setRangeEnd(nextEnd);
    if (currentBaseIDs.length) current.refetch();
    if (additionalCurrentIDs.length) additionalCurrent.refetch();
  };
  return <section className={styles.root} aria-label="Resource metrics">
    <header className={styles.heading}><Text weight="semibold" size="lg">Metrics</Text><Text size="xs" tone="muted">{props.resourceNamespace}</Text></header>
    <div className={styles.toolbar}>
      <SimpleSelect aria-label="Metric source" value={bindingID} onChange={value => { setBindingID(value); setAdditional([]); setHidden([]); }} options={[
        { value: '', label: <><LuDatabase size={14} />{!bindingID ? sourceLabel : 'Connection default'}</> },
        { value: 'native', label: 'Native Kubernetes' },
        ...sources.map(binding => ({ value: binding.id, label: <><LuDatabase size={14} />{selectedBinding?.id === binding.id ? sourceLabel : `${binding.source.connection_id} / ${binding.source.datasource_uid}`} ({binding.policy})</> })),
      ]} className={styles.source} />
      <div className={styles.timeControls}>
        <SimpleSelect aria-label="Time range" value={duration} onChange={value => { setDuration(value); setRangeEnd(alignedHistoryEnd()); }} options={[
          { value: '900000', label: 'Last 15 minutes' }, { value: '3600000', label: 'Last 1 hour' },
          { value: '10800000', label: 'Last 3 hours' }, { value: '21600000', label: 'Last 6 hours' },
          { value: '43200000', label: 'Last 12 hours' }, { value: '86400000', label: 'Last 24 hours' },
        ]} />
        <IconButton aria-label="Refresh metrics" title="Refresh metrics" size="sm" variant="outline" onClick={refresh}><LuRefreshCw /></IconButton>
        <Text size="xs" tone="muted">30s</Text>
      </div>
    </div>
    <div className={styles.selection}>
      {selected.map((definition, index) => <Button key={definition.id} size="xs" variant="outline" className={styles.chip} aria-label={`Remove ${definition.name}`} onClick={() => {
        setHidden(ids => [...ids, definition.id]); setAdditional(ids => ids.filter(id => id !== definition.id));
      }}><span className={styles.swatch} style={{ background: palette[index % palette.length] }} />{definition.name}<LuX size={11} /></Button>)}
      <Popover.Root open={browserOpen} onOpenChange={setBrowserOpen}>
        <Popover.Trigger render={<Button size="xs" variant="outline" className={styles.add}><LuPlus />Add metric</Button>} />
        <Popover.Portal><Popover.Positioner side="bottom" align="start" sideOffset={8}>
          <Popover.Popup className={styles.browser}>
            <Text size="sm" weight="semibold">Add metric</Text>
            <SearchInput aria-label="Search metrics" placeholder="Search metrics…" size="sm" value={search} onValueChange={setSearch} />
            <div className={styles.options}>
              {available.filter((definition, index) => available.findIndex(item => item.id === definition.id) === index && definition.name.toLowerCase().includes(search.toLowerCase())).map(definition =>
                <Button key={definition.id} aria-label={definition.name} variant="ghost" size="sm" disabled={selectedIDs.includes(definition.id)} className={styles.option} onClick={() => {
                  setHidden(ids => ids.filter(id => id !== definition.id));
                  setAdditional(ids => [...new Set([...ids, definition.id])]); setBrowserOpen(false); setSearch('');
                }}><span><strong>{definition.name}</strong><small>{UNIT_LABELS[definition.unit]}{definition.supported_shapes?.includes(1) ? ' · Time series' : ' · Current value'}</small></span><LuPlus /></Button>)}
              {!available.some(definition => definition.name.toLowerCase().includes(search.toLowerCase())) && <Text size="xs" tone="muted">No matching metrics</Text>}
            </div>
            <footer className={styles.browserFooter}>{sourceLabel}<span>{available.length} metrics</span></footer>
          </Popover.Popup>
        </Popover.Positioner></Popover.Portal>
      </Popover.Root>
    </div>
    {!enabled && <Text size="xs">Canonical resource target unavailable.</Text>}
    {error && <Text role="alert" tone="danger">{error instanceof Error ? error.message : 'Metrics request failed'}</Text>}
    {(currentLoading || bindings.isLoading || (selectedBinding && definitions.isLoading) || (needsNative && nativeProviders.isLoading)) && <Spinner size="sm" />}
    <div className={styles.cards}>
      {selected.map((definition, index) => {
        const matches = results.filter(result => result.metric_id === definition.id);
        const historyLane = baseIDs.includes(definition.id) ? history : additionalHistory;
        const histories = historyResults.filter(result => result.metric_id === definition.id);
        const laneResults = [...matches, ...histories];
        const lanes = new Map<string, typeof laneResults>();
        for (const result of laneResults) {
          const key = JSON.stringify([result.provenance.native, result.provenance.source, result.dimensions]);
          const lane = lanes.get(key);
          if (lane) lane.push(result);
          else lanes.set(key, [result]);
        }
        const color = palette[index % palette.length];
        const supportsHistory = descriptors.some(item => item.id === definition.id && item.supported_shapes?.includes(1));
        const series = histories.filter(result => ['ok', 'partial', 'stale'].includes(result.status)).flatMap((result, seriesIndex) => {
          const points = result.value?.time_series?.data_points ?? [];
          return points.length ? [{
            id: `${definition.id}-${seriesIndex}`, label: [definition.name, ...Object.entries(result.dimensions ?? {}).map(([key, value]) => `${key}: ${value}`), result.provenance.native ? 'Native Kubernetes' : result.provenance.source.datasource_uid].join(' · '),
            color, data: points.filter(point => Number.isFinite(point.value)).map(point => ({ timestamp: new Date(point.timestamp).getTime(), value: point.value })),
          }] : [];
        });
        return <article key={definition.id} className={styles.card}>
          <header className={styles.cardTitle}>{definition.name}</header>
          <div className={styles.values}>
            {!matches.length && <Text size="xs" tone="muted">{currentLoading ? 'Loading…' : 'Not reported'}</Text>}
            {matches.map((result, resultIndex) => {
              const resultDefinition = (result.provenance.native ? nativeMetrics : externalMetrics).find(item => item.id === definition.id);
              const measurement = displayMeasurement(result, resultDefinition?.unit ?? definition.unit);
              return <div key={resultIndex}>
                <div className={styles.value} style={{ color }}>{measurement.value} <span>{measurement.unit}</span></div>
                {Object.keys(result.dimensions ?? {}).length > 0 && <Text size="xs" tone="muted">{Object.entries(result.dimensions).map(([key, value]) => `${key}: ${value}`).join(' · ')}</Text>}
              </div>;
            })}
          </div>
          {supportsHistory ? <TimeSeriesChart series={series} timeRange={timeRange} area height={180} yAxis="outside" valueFormatter={value => value == null ? '–' : formatMeasurement(value, definition.unit)} loading={historyLane.isLoading} error={historyLane.error instanceof Error ? historyLane.error.message : undefined} emptyContent={<Text size="xs" tone="muted">No history measurements</Text>} /> : <div className={styles.noHistory}><Text size="xs" tone="muted">Current value only</Text></div>}
          <footer className={styles.cardFooter}>
            {[...lanes.values()].map((lane, laneIndex) => {
              const result = lane[0];
              const states = [...new Set(lane.map(item => metricResultDisplay(item).endsWith('(stale)') ? 'stale' : item.status).filter(status => status !== 'ok'))];
              const laneSource = result.provenance.native ? 'Native Kubernetes' : result.provenance.source.connection_id === selectedBinding?.source.connection_id && result.provenance.source.datasource_uid === selectedBinding?.source.datasource_uid ? sourceLabel : `${result.provenance.source.plugin_id} / ${result.provenance.source.datasource_uid}`;
              return <details key={laneIndex} className={styles.provenance}>
                <summary aria-label={`${definition.name} ${lanes.size > 1 ? laneSource : 'source'} details`}><span className={styles.swatch} style={{ background: color }} />{lanes.size > 1 ? laneSource : 'Details'}<span>{states.join(' · ')}</span></summary>
                <div>Source: {laneSource}</div>
                {lane.map((item, itemIndex) => <div key={itemIndex}>
                  <div>{item.value?.time_series ? 'History' : 'Current'} · {item.status}</div>
                  {!item.provenance.native && <div>Connection: {item.provenance.source.connection_id}</div>}
                  {item.observed_at && <div>Observed: {item.observed_at}</div>}
                  {item.expires_at && <div>Expires: {item.expires_at}</div>}
                  {item.mapping_revision && <div>Revision: {item.mapping_revision}</div>}
                  {Object.entries(item.dimensions ?? {}).map(([key, value]) => <div key={key}>{key}: {value}</div>)}
                  {Object.entries(item.value?.time_series?.labels ?? item.value?.current_value?.labels ?? {}).map(([key, value]) => <div key={key}>{key}: {value}</div>)}
                </div>)}
              </details>;
            })}
            {[...matches, ...histories].flatMap(result => result.warnings ?? []).map((warning, warningIndex) => <Text key={warningIndex} size="xs" tone="warning">{warning}</Text>)}
          </footer>
        </article>;
      })}
    </div>
    {[...(current.data?.warnings ?? []), ...(additionalCurrent.data?.warnings ?? []), ...(history.data?.warnings ?? []), ...(additionalHistory.data?.warnings ?? [])].map((warning, index) => <Text key={index} size="xs">{warning}</Text>)}
    {!selected.length && <Text size="xs" tone="muted">No metrics selected.</Text>}
    <details className={styles.queries}>
      <summary><LuChevronRight size={12} /><LuCode size={14} />Queries · {queryDefinitions.length}</summary>
      {queryDefinitions.map(definition => {
        const override = selectedBinding?.overrides?.find(item => item.metric_id === definition.id);
        const query = override?.query ?? definition.query;
        return <div key={definition.id} className={styles.query}>
          <header>{definition.name}<span>{override?.query != null ? 'Connection override' : 'Inherited'} · Template</span></header>
          <pre><code>{query.split(/("(?:\\.|[^"\\])*"|\{\{[^}]+\}\}|\b(?:sum|rate|by|avg|max|min|count|irate)\b)/g).map((part, index) =>
            <span key={index} className={part.startsWith('"') ? styles.string : part.startsWith('{{') ? styles.variable : /^(sum|rate|by|avg|max|min|count|irate)$/.test(part) ? styles.fn : undefined}>{part.split(/(\{\{[^}]+\}\})/g).map((value, nested) => <span key={nested} className={value.startsWith('{{') ? styles.variable : undefined}>{value}</span>)}</span>)}</code></pre>
          <div className={styles.bindings}>{(override?.field_bindings ?? definition.field_bindings ?? []).map(binding => <span key={binding.label}><code>{`{{${binding.label}}}`}</code> {binding.source} · {binding.resource_path ?? binding.field}</span>)}<span>{definition.query_language}</span></div>
        </div>;
      })}
      {!queryDefinitions.length && <div className={styles.query}>Selected metrics do not expose a query template.</div>}
    </details>
  </section>;
}
