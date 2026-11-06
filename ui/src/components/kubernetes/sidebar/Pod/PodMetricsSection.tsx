import { Button, IconButton, Stack, Text } from '@omniviewdev/base-ui';
import { CapacityBar, MetricDetails, MetricDisplayPicker, MetricPanel, MetricValue, TimeRangeControl, type MetricPanelState, type TimeSelection } from '@omniviewdev/base-ui/metrics';
import { useMetricObservation, useMetricViewPreferences, type DrawerContext, type ResourceReference, type AccessRoute, type Value } from '@omniviewdev/runtime';
import type { Pod } from 'kubernetes-types/core/v1';
import { useMemo } from 'react';
import { LuArrowUp, LuLayoutGrid, LuRows2 } from 'react-icons/lu';

import { podMetricBound } from './podMetricBound';
import styles from './PodMetricsSection.module.css';
import PodPrometheusMetricsSection from './PodPrometheusMetricsSection';

import { PLUGIN_ID } from '@/pluginId';

const metrics = [
  { id: 'kubernetes.pod.cpu.usage', label: 'CPU', resource: 'cpu' as const },
  { id: 'kubernetes.pod.memory.working_set', label: 'Memory working set', resource: 'memory' as const },
];

const initialPreferences = {
  metric_ids: metrics.map(metric => metric.id),
};

interface Props {
  connectionID: string;
  resourceKey: string;
  resourceID: string;
  resourceNamespace: string;
  resourceData?: Value;
  pod?: Pod;
  reference?: ResourceReference;
  route?: AccessRoute;
}

/** Native current samples remain separate from genuine Prometheus history. */
export default function PodMetricsSection(props: Props) {
  const { preferences, update: savePreferences, error: preferenceError } = useMetricViewPreferences(PLUGIN_ID, props.resourceKey, initialPreferences);
  // The hook publishes save failures below; event handlers must also consume rejection.
  const update = (patch: Parameters<typeof savePreferences>[0]) => savePreferences(patch).catch(() => undefined);
  const targets = useMemo(() => props.reference && props.route
    ? [{ token: props.resourceID, reference: props.reference, route: props.route }] : [],
  [props.resourceID, props.reference, props.route]);
  const selected = preferences.metric_ids;
  const observation = useMetricObservation({
    ownerPluginID: PLUGIN_ID,
    ownerConnectionID: props.connectionID,
    resourceKey: props.resourceKey,
    targets,
    metricIDs: selected,
    shape: 'current',
    intervalMs: 15_000,
    enabled: targets.length > 0 && selected.length > 0,
  });
  const time: TimeSelection = preferences.time_mode === 'absolute'
    ? { mode: 'absolute', domain: { startMs: preferences.start_ms, endMs: preferences.end_ms } }
    : { mode: 'relative', durationMs: preferences.duration_ms };
  const ordered = selected.flatMap(id => {
    const metric = metrics.find(item => item.id === id);
    return metric ? [metric] : [];
  });
  return <Stack direction="column" spacing={2}>
    <div className={styles.Controls}>
      <span className={styles.Live} title="Metrics-server provides live samples, not historical queries.">Live</span>
      <TimeRangeControl value={time} onChange={value => { void update(value.mode === 'relative'
        ? { time_mode: 'relative', duration_ms: value.durationMs }
        : { time_mode: 'absolute', start_ms: value.domain.startMs, end_ms: value.domain.endMs }); }}
        onRefresh={() => { void observation.refresh(); }} refreshing={observation.isFetching} />
      <IconButton size="sm" variant="ghost" aria-label={preferences.layout === 'stack' ? 'Use grid layout' : 'Use list layout'}
        onClick={() => { void update(current => ({ layout: current.layout === 'stack' ? 'grid' : 'stack' })); }}>
        {preferences.layout === 'stack' ? <LuLayoutGrid /> : <LuRows2 />}
      </IconButton>
      {metrics.map(metric => <Button key={metric.id} size="sm" variant={selected.includes(metric.id) ? 'soft' : 'ghost'}
        aria-pressed={selected.includes(metric.id)} onClick={() => { void update(current => ({ metric_ids: current.metric_ids.includes(metric.id)
          ? current.metric_ids.filter(id => id !== metric.id) : [...current.metric_ids, metric.id] })); }}>{metric.label}</Button>)}
    </div>
    {preferenceError && <Text size="xs" tone="danger" role="alert" title={String(preferenceError)}>Metric preferences unavailable</Text>}
    <div className={styles.Panels} data-layout={preferences.layout}>
      {ordered.filter(metric => selected.includes(metric.id)).map(metric => {
        const result = observation.results.find(result => result.resourceToken === props.resourceID && result.metricID === metric.id);
        const state: MetricPanelState = result?.status === 'ok' ? { kind: 'data', updating: observation.isFetching,
            freshness: result.freshness === 'delayed' ? 'delayed' : undefined,
            notice: observation.error ? { tone: 'warning', label: 'Refresh failed' } : undefined }
          : observation.error ? { kind: 'error', message: String(observation.error) }
          : observation.isLoading || (!result && observation.isFetching) ? { kind: 'initial' }
          : result?.status === 'denied' ? { kind: 'denied' }
          : result?.status === 'unsupported' ? { kind: 'unsupported' }
          : { kind: 'empty', message: 'No sample' };
        const display = preferences.displays[metric.id] === 'capacity' ? 'capacity' : 'stat';
        const limit = podMetricBound(props.pod, metric.resource, 'limits');
        const request = podMetricBound(props.pod, metric.resource, 'requests');
        const visibleOrder = ordered.filter(item => selected.includes(item.id));
        return <MetricPanel key={metric.id} title={metric.label} state={state}
          actions={<div className={styles.Actions}>
            <IconButton size="xs" variant="ghost" aria-label={`Move ${metric.label} earlier`}
              disabled={visibleOrder[0]?.id === metric.id}
              onClick={() => { void update(current => {
                const metric_ids = [...current.metric_ids];
                const index = metric_ids.indexOf(metric.id);
                if (index > 0) [metric_ids[index - 1], metric_ids[index]] = [metric_ids[index], metric_ids[index - 1]];
                return { metric_ids };
              }); }}><LuArrowUp /></IconButton>
            <MetricDisplayPicker value={display} options={[{ value: 'stat', label: 'Value' }, { value: 'capacity', label: 'Capacity' }]}
              onChange={value => { void update({ displays: { [metric.id]: value === 'stat' ? 'value' : value } }); }} />
          </div>}
          details={{ open: preferences.details[metric.id] ?? false,
            onOpenChange: open => { void update({ details: { [metric.id]: open } }); },
            content: <MetricDetails source="Metrics-server"
              samples={[{ id: 'current', label: 'Current', status: result?.status === 'ok'
                ? result.observedAt == null ? 'unknown' : result.freshness === 'delayed' ? 'delayed' : 'ok' : 'error',
                updatedAtMs: result?.observedAt ?? undefined }]}
              labels={{ namespace: props.resourceNamespace, pod: props.resourceID }}
              items={[
                { id: 'window', label: 'Measurement window', value: result ? `${result.windowMs / 1000} s` : '—' },
                { id: 'identity', label: 'Attribution', value: result?.identityScope === 'incarnation' ? 'UID verified' : 'Name scoped', advanced: true },
                ...(result?.message ? [{ id: 'status', label: 'Status', value: result.message, advanced: true }] : []),
              ]} /> }}>
          {!result?.unit ? <Text size="xs" tone="muted">Metric unit unavailable</Text> : display === 'capacity'
            ? <CapacityBar value={result.status === 'ok' ? result.value : null} unit={result.unit} label={metric.label}
                request={request} bound={limit == null ? request == null ? undefined : { value: request, kind: 'request' } : { value: limit, kind: 'limit' }} />
            : <MetricValue value={result.status === 'ok' ? result.value : null} unit={result.unit} size="sm" />}
        </MetricPanel>;
      })}
    </div>
  </Stack>;
}

export function PodMetricsView({ ctx }: { ctx: DrawerContext<unknown> }) {
  const pod = ctx.data as Pod | undefined;
  const props = {
    connectionID: ctx.resource?.route.connection ?? '',
    resourceKey: ctx.resource?.reference.address.type ?? 'k8s:/pods',
    resourceID: ctx.resource?.reference.address.id ?? '',
    resourceNamespace: pod?.metadata?.namespace ?? '',
    pod,
    resourceData: ctx.resource?.record?.record.body,
    reference: ctx.resource?.reference,
    route: ctx.resource?.route,
  };
  return <Stack direction="column" spacing={3}>
    <PodMetricsSection {...props} />
    <PodPrometheusMetricsSection {...props} />
  </Stack>;
}
