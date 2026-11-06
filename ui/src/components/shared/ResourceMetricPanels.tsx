import { Button, IconButton, Popover, SearchInput, Stack, Text } from '@omniviewdev/base-ui';
import { CapacityBar, MetricDetails, MetricDisplayPicker, MetricPanel, MetricValue, TimeRangeControl, TimeSeriesChart, type MetricPanelState, type TimeSelection } from '@omniviewdev/base-ui/metrics';
import { parseAppError, useMetricCatalog, useMetricObservation, useMetricViewPreferences, useMetricViewSourceSelection, type UseMetricObservationOptions, type ResourceMetricTarget, type ResourceMetricsCatalog, type ResourceReference, type AccessRoute } from '@omniviewdev/runtime';
import type { UseQueryResult } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { LuArrowUp, LuLayoutGrid, LuPlus, LuRefreshCw, LuRows2, LuX } from 'react-icons/lu';

import MetricSourcePicker from './MetricSourcePicker';
import styles from './ResourceMetricPanels.module.css';

import { PLUGIN_ID } from '@/pluginId';

const METRIC_COLORS = ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8'] as const;

export interface ResourceMetricPanelsProps extends Pick<UseMetricObservationOptions, 'bindingID' | 'source'> {
  connectionID: string;
  resourceKey: string;
  resourceID?: string;
  defaultMetricIDs?: readonly string[];
  targets?: ResourceMetricTarget[];
  reference?: ResourceReference;
  route?: AccessRoute;
  capacities?: Record<string, { request?: number; limit?: number }>;
}

function metricError(error: unknown) {
  const parsed = parseAppError(error);
  const detail = parsed.detail || parsed.title;
  return { code: parsed.code, detail, label: detail.length > 180 ? `${detail.slice(0, 177)}…` : detail };
}

/** Source routing belongs to owner settings; presentation belongs to the resource kind. */
export default function ResourceMetricPanels(props: ResourceMetricPanelsProps) {
  const selection = useMetricViewSourceSelection(PLUGIN_ID, props.connectionID, props.resourceKey);
  const source = props.source ?? (selection.selection?.mode === 'external' ? selection.selection.source
    : selection.selection?.mode === 'native' ? { plugin_id: PLUGIN_ID, connection_id: props.connectionID, datasource_uid: '', datasource_kind: 'metrics-server' } : undefined);
  const ready = !selection.isLoading && !selection.error;
  const scope = { ownerPluginID: PLUGIN_ID, ownerConnectionID: props.connectionID, resourceKey: props.resourceKey, bindingID: props.bindingID, source, enabled: ready };
  const catalog = useMetricCatalog(scope);
  const sourceControl = <MetricSourcePicker ownerPluginID={PLUGIN_ID} ownerConnectionID={props.connectionID} resourceKey={props.resourceKey} />;
  if (!ready || !catalog.data) return <Stack direction="column" spacing={2}>{sourceControl}
    <Text role={selection.error || catalog.error ? 'alert' : 'status'} tone={selection.error || catalog.error ? 'danger' : 'muted'}>{selection.error || catalog.error ? metricError(selection.error ?? catalog.error).label : 'Loading metrics…'}</Text>
  </Stack>;
  return <SelectedMetricPanels {...props} source={source} catalog={catalog} sourceControl={sourceControl} />;
}

function SelectedMetricPanels({ catalog, sourceControl, ...props }: ResourceMetricPanelsProps & { catalog: UseQueryResult<ResourceMetricsCatalog | null, Error>; sourceControl: ReactNode }) {
  const scope = { ownerPluginID: PLUGIN_ID, ownerConnectionID: props.connectionID, resourceKey: props.resourceKey, bindingID: props.bindingID, source: props.source };
  const initial = { metric_ids: (props.defaultMetricIDs ?? []).filter(id => catalog.data?.metrics.some(metric => metric.id === id)) };
  const view = useMetricViewPreferences(PLUGIN_ID, props.resourceKey, initial);
  const { preferences } = view;
  const update = (patch: Parameters<typeof view.update>[0]) => view.update(patch).catch(() => undefined);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [search, setSearch] = useState('');
  const targets = props.targets ?? (props.reference && props.route && props.resourceID
    ? [{ token: props.resourceID, reference: props.reference, route: props.route }] : []);
  const descriptors = catalog.data?.metrics ?? [];
  const ordered = preferences.metric_ids.flatMap(id => descriptors.filter(metric => metric.id === id));
  const colors = useMemo(() => new Map(preferences.metric_ids.map((id, index) =>
    [id, METRIC_COLORS[index % METRIC_COLORS.length]] as const)), [preferences.metric_ids]);
  const rangeIDs = ordered.filter(metric => metric.shapes.includes('range')).map(metric => metric.id);
  const currentIDs = ordered.filter(metric => !metric.shapes.includes('range') && metric.shapes.includes('current')).map(metric => metric.id);
  const range = rangeIDs.length > 0;
  const time: TimeSelection = preferences.time_mode === 'absolute'
    ? { mode: 'absolute', domain: { startMs: preferences.start_ms, endMs: preferences.end_ms } }
    : { mode: 'relative', durationMs: preferences.duration_ms };
  const enabled = !catalog.isLoading && !catalog.error && !view.isLoading;
  const currentObservation = useMetricObservation({ ...scope, targets, metricIDs: currentIDs,
    shape: 'current', intervalMs: 15000, enabled: enabled && currentIDs.length > 0 });
  const rangeObservation = useMetricObservation({ ...scope, targets, metricIDs: rangeIDs, shape: 'range',
    durationMs: time.mode === 'relative' ? time.durationMs : undefined,
    startTime: time.mode === 'absolute' ? new Date(time.domain.startMs).toISOString() : undefined,
    endTime: time.mode === 'absolute' ? new Date(time.domain.endMs).toISOString() : undefined,
    stepMs: Math.max(15000, Math.ceil((time.mode === 'relative' ? time.durationMs : time.domain.endMs - time.domain.startMs) / 250)),
    intervalMs: 15000, enabled: enabled && rangeIDs.length > 0 });
  const refresh = () => Promise.all([
    ...(currentIDs.length ? [currentObservation.refresh()] : []),
    ...(rangeIDs.length ? [rangeObservation.refresh()] : []),
  ]);
  const refreshing = currentObservation.isFetching || rangeObservation.isFetching;
  return <Stack direction="column" spacing={2}>
    <div className={styles.toolbar}>
      {sourceControl}
      <div className={styles.timeControls}>
        {range && <TimeRangeControl value={time} onChange={value => { void update(value.mode === 'relative'
          ? { time_mode: 'relative', duration_ms: value.durationMs }
          : { time_mode: 'absolute', start_ms: value.domain.startMs, end_ms: value.domain.endMs }); }}
          onRefresh={() => { void refresh(); }} refreshing={refreshing} />}
        {!range && <IconButton size="sm" aria-label="Refresh metrics" onClick={() => { void refresh(); }}><LuRefreshCw /></IconButton>}
        <IconButton size="sm" aria-label="Toggle metric layout" onClick={() => { void update({ layout: preferences.layout === 'stack' ? 'grid' : 'stack' }); }}>
          {preferences.layout === 'stack' ? <LuLayoutGrid /> : <LuRows2 />}
        </IconButton>
      </div>
    </div>
      <div className={styles.selection}>
        {preferences.metric_ids.map(id => <Button key={id} size="xs" variant="outline" className={styles.chip}
          aria-label={`Remove ${descriptors.find(metric => metric.id === id)?.name ?? id}`}
          onClick={() => { void update(current => ({ metric_ids: current.metric_ids.filter(value => value !== id) })); }}>
          <span aria-hidden className={styles.swatch} style={{ backgroundColor: `var(--ov-color-chart-${colors.get(id)})` }} />
          {descriptors.find(metric => metric.id === id)?.name ?? `${id} · unavailable`}<LuX size={11} />
        </Button>)}
        <Popover.Root open={browserOpen} onOpenChange={setBrowserOpen}>
          <Popover.Trigger render={<Button size="xs" variant="outline" className={styles.add}><LuPlus size={12} />Add metric</Button>} />
          <Popover.Portal><Popover.Positioner side="bottom" align="start" sideOffset={8}>
            <Popover.Popup className={styles.browser}>
              <SearchInput aria-label="Search metrics" placeholder="Search metrics…" size="sm" value={search} onValueChange={setSearch} />
              <div className={styles.options}>
                {descriptors.filter(metric => `${metric.name} ${metric.description}`.toLowerCase().includes(search.toLowerCase())).map(metric =>
                  <Button key={metric.id} variant="ghost" size="sm" className={styles.option}
                    disabled={preferences.metric_ids.includes(metric.id)} onClick={() => {
                      void update(current => ({ metric_ids: [...current.metric_ids, metric.id] }));
                      setBrowserOpen(false); setSearch('');
                    }}>{metric.name}<LuPlus size={12} /></Button>)}
                {!descriptors.some(metric => `${metric.name} ${metric.description}`.toLowerCase().includes(search.toLowerCase())) &&
                  <Text size="xs" tone="muted">No matching metrics</Text>}
              </div>
            </Popover.Popup>
          </Popover.Positioner></Popover.Portal>
        </Popover.Root>
      </div>
    {(catalog.error || view.error) && <Text role="alert" tone="danger">{metricError(catalog.error ?? view.error).label}</Text>}
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: preferences.layout === 'stack' ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))' }}>
      {ordered.map((metric, index) => {
        const color = colors.get(metric.id);
        const history = metric.shapes.includes('range');
        const observation = history ? rangeObservation : currentObservation;
        const results = observation.results.filter(result => result.metricID === metric.id && (!props.resourceID || result.resourceToken === props.resourceID));
        const result = results[0];
        const failedResult = results.find(sample => sample.status === 'failed' || sample.status === 'ambiguous' ||
          sample.status === 'invalid_context' || sample.status === 'invalid_mapping');
        const failure = observation.error ? metricError(observation.error) : failedResult ? metricError({
          type: 'metrics', title: 'Metric query failed', status: 502,
          code: failedResult.status.toUpperCase(), detail: failedResult.message || 'Metric query failed.',
        }) : null;
        const savedDisplay = preferences.displays[metric.id];
        const display = savedDisplay === 'capacity' && props.capacities?.[metric.id] ? 'capacity'
          : history && savedDisplay !== 'value'
            ? savedDisplay === 'line' || savedDisplay === 'sample-bars' ? savedDisplay : 'area'
            : 'stat';
        const state: MetricPanelState = results.some(result => result.status === 'ok')
          ? { kind: 'data', updating: observation.isFetching, freshness: results.some(sample => sample.freshness === 'delayed') ? 'delayed' : undefined,
            notice: failure ? { tone: 'warning', label: failure.label } : undefined }
          : failure ? { kind: failure.code === 'DENIED' || failure.code === 'FORBIDDEN' || failure.code === 'UNAUTHORIZED' ? 'denied' : failure.code === 'UNSUPPORTED' ? 'unsupported' : 'error', message: failure.label }
          : observation.isLoading ? { kind: 'initial' }
          : result?.status === 'denied' ? { kind: 'denied' }
          : result?.status === 'unsupported' ? { kind: 'unsupported' } : { kind: 'empty', message: 'No sample' };
        const unit = result?.unit ?? { kind: 'number' as const };
        const chartDomain = observation.domain?.startMs != null && observation.domain.endMs != null
          ? { startMs: observation.domain.startMs, endMs: observation.domain.endMs } : time.mode === 'absolute' ? time.domain : null;
        return <MetricPanel key={metric.id} title={metric.name} state={state}
          actions={<Stack direction="row" spacing={1}>
            <IconButton size="xs" aria-label={`Move ${metric.name} earlier`} disabled={index === 0} onClick={() => { void update(current => {
              const metric_ids = [...current.metric_ids];
              const position = metric_ids.indexOf(metric.id);
              if (position > 0) [metric_ids[position - 1], metric_ids[position]] = [metric_ids[position], metric_ids[position - 1]];
              return { metric_ids };
            }); }}><LuArrowUp /></IconButton>
            {(history || props.capacities?.[metric.id]) && <MetricDisplayPicker value={display} label={`${metric.name} display`} presentation="menu"
              options={[{ value: 'stat', label: 'Value' }, ...(history ? [
                { value: 'area' as const, label: 'Area' }, { value: 'line' as const, label: 'Line' },
                { value: 'sample-bars' as const, label: 'Bars' },
              ] : []), ...(props.capacities?.[metric.id] ? [{ value: 'capacity' as const, label: 'Capacity' }] : [])]}
              onChange={value => { void update({ displays: { [metric.id]: value === 'stat' ? 'value' : value } }); }} />}
          </Stack>}
          details={{ color, open: preferences.details[metric.id] ?? false, onOpenChange: open => { void update({ details: { [metric.id]: open } }); },
            content: <MetricDetails source={result?.source?.datasource_kind ?? catalog.data?.source.datasource_kind ?? 'Unknown'} labels={result?.dimensions ?? {}}
              samples={results.map(sample => ({ id: sample.id, label: props.targets ? sample.resourceToken : history ? 'History' : 'Current',
                status: sample.status !== 'ok' ? 'error' : history ? 'ok' : sample.freshness === 'delayed' ? 'delayed' : sample.observedAt === null ? 'unknown' : 'ok',
                updatedAtMs: sample.observedAt ?? sample.points.at(-1)?.timeMs, validUntilMs: sample.freshUntilMs ?? undefined }))}
              items={[{ id: 'identity', label: 'Attribution', value: result?.identityScope === 'incarnation' ? 'UID verified' : 'Name scoped' },
                ...(result && result.windowMs > 0 ? [{ id: 'window', label: 'Measurement window', value: `${result.windowMs / 1000} s` }] : []),
                ...(failure ? [{ id: 'diagnostic', label: failure.code || 'Diagnostic', value: failure.detail }] : [])]} /> }}>
          <Stack direction="column" spacing={2}>
            {results.map(sample => <div key={sample.id}>
              {props.targets && <Text size="xs">{sample.resourceToken}</Text>}
              <MetricValue size="lg" color={color} unit={unit} value={sample.status === 'ok' ? sample.value ?? sample.points.at(-1)?.value ?? null : null} />
              {display === 'capacity' && <CapacityBar label={metric.name} color={color} unit={unit} value={sample.status === 'ok' ? sample.value : null}
                request={props.capacities?.[metric.id]?.request}
                bound={props.capacities?.[metric.id]?.limit != null ? { kind: 'limit', value: props.capacities[metric.id].limit! }
                  : props.capacities?.[metric.id]?.request != null ? { kind: 'request', value: props.capacities[metric.id].request! } : undefined} showValue={false} />}
            </div>)}
            {!results.length && <MetricValue size="lg" unit={unit} value={null} />}
            {history && (display === 'area' || display === 'line' || display === 'sample-bars') && chartDomain && <TimeSeriesChart label={`${metric.name} history`} unit={unit} domain={chartDomain} mode={display}
              series={results.map(series => ({ id: series.id, color: props.targets ? undefined : color, label: props.targets ? series.resourceToken : metric.name, points: series.points }))} />}
          </Stack>
        </MetricPanel>;
      })}
    </div>
  </Stack>;
}
