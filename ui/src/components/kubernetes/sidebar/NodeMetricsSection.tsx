import { Progress, Spinner, Stack, Text } from '@omniviewdev/base-ui';
import { useResourceMetrics } from '@omniviewdev/runtime';
import { type metric } from '@omniviewdev/runtime/models';
import React, { useState, useMemo, useCallback } from 'react';

import { MetricsPanel } from '../../shared/charts';
import type { TimeSeriesDef, ChartTimeRange } from '../../shared/charts';

import { PLUGIN_ID } from '@/pluginId';

const outerBoxStyle: React.CSSProperties = {
  borderRadius: 4,
  border: '1px solid var(--ov-color-border-default)',
};
const metricsHeaderStyle: React.CSSProperties = {
  paddingBlock: 4,
  paddingInline: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const metricsContentStyle: React.CSSProperties = { paddingInline: 4, paddingBottom: 8 };
const loadingBoxStyle: React.CSSProperties = { display: 'flex', justifyContent: 'center', paddingBlock: 16 };
const noMetricsHeaderStyle: React.CSSProperties = { paddingBlock: 4, paddingInline: 8 };
const noMetricsBodyStyle: React.CSSProperties = { paddingInline: 8, paddingBottom: 8 };
const errorBoxStyle: React.CSSProperties = { paddingInline: 8, paddingBottom: 4 };
const gaugeValueStyle: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const gaugeSubtitleStyle: React.CSSProperties = { fontSize: '0.6rem', marginTop: 2 };
const gaugeContainerStyle: React.CSSProperties = { minWidth: 0, flex: 1 };
const gaugeHeaderStyle: React.CSSProperties = { marginBottom: 2 };
const statTileStyle: React.CSSProperties = {
  paddingBlock: 4,
  paddingInline: 8,
  borderRadius: 4,
  border: '1px solid var(--ov-color-border-default)',
  background: 'var(--ov-color-bg-surface-raised)',
};
const statLabelStyle: React.CSSProperties = { display: 'block', marginBottom: 2 };
const statValueStyle: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const sectionSubheadingStyle: React.CSSProperties = {
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontSize: '0.6rem',
  marginBottom: 6,
};
const sectionSubheadingAltStyle: React.CSSProperties = { ...sectionSubheadingStyle, marginBottom: 4 };
const sectionPaddingStyle: React.CSSProperties = { paddingInline: 4 };
/** Two equal columns with 4px gap (MUI Grid spacing 0.5, size 6). */
const tileGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 4,
};

interface Props {
  connectionID: string;
  resourceKey: string;
  resourceID: string;
  resourceData?: Record<string, unknown>;
}

/** Extract current-value metrics keyed by metric_id */
function extractCurrentMetrics(
  data: Record<string, metric.QueryResponse> | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!data) return out;

  for (const [, resp] of Object.entries(data)) {
    if (!resp?.success || !resp.results) continue;
    for (const result of resp.results) {
      if (result.current_value) {
        out.set(result.current_value.metric_id, result.current_value.value);
      }
    }
  }
  return out;
}

/** Extract time-series results keyed by metric_id */
function extractTimeSeries(
  data: Record<string, metric.QueryResponse> | undefined,
): Map<string, metric.TimeSeries> {
  const out = new Map<string, metric.TimeSeries>();
  if (!data) return out;

  for (const [, resp] of Object.entries(data)) {
    if (!resp?.success || !resp.results) continue;
    for (const result of resp.results) {
      if (result.time_series) {
        out.set(result.time_series.metric_id, result.time_series);
      }
    }
  }
  return out;
}

/** Convert SDK TimeSeries to chart-compatible TimeSeriesDef */
function toTimeSeriesDef(ts: metric.TimeSeries, label: string, color?: string): TimeSeriesDef {
  return {
    id: ts.metric_id,
    label,
    // dp.timestamp is a Wails-serialized time.Time (ISO string at runtime)
    data: (ts.data_points ?? []).map((dp) => ({
      timestamp: new Date(dp.timestamp).getTime(),
      value: dp.value,
    })),
    color,
    area: true,
  };
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function formatBytesPerSec(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB/s`;
  return `${value.toFixed(0)} B/s`;
}

/** Percentage gauge with label and bar */
const PercentGauge: React.FC<{
  label: string;
  value: number;
  subtitle?: string;
}> = ({ label, value, subtitle }) => {
  const color = value >= 90 ? 'danger' : value >= 70 ? 'warning' : 'brand';

  return (
    <div style={gaugeContainerStyle}>
      <Stack direction="row" justify="between" align="baseline" style={gaugeHeaderStyle}>
        <Text size="xs" tone="muted">
          {label}
        </Text>
        <Text size="xs" weight="semibold" style={gaugeValueStyle}>
          {value.toFixed(1)}%
        </Text>
      </Stack>
      <Progress size="xs" value={Math.min(value, 100)} color={color} aria-label={`${label} utilization`} />
      {subtitle && (
        <Text as="div" size="xs" tone="subtle" style={gaugeSubtitleStyle}>
          {subtitle}
        </Text>
      )}
    </div>
  );
};

/** Compact stat tile */
const StatTile: React.FC<{
  label: string;
  value: string;
}> = ({ label, value }) => (
  <div style={statTileStyle}>
    <Text size="xs" tone="muted" style={statLabelStyle}>
      {label}
    </Text>
    <Text size="sm" weight="semibold" style={statValueStyle}>
      {value}
    </Text>
  </div>
);

const NodeMetricsSection: React.FC<Props> = ({
  connectionID,
  resourceKey,
  resourceID,
  resourceData,
}) => {
  const [timeRange, setTimeRange] = useState<ChartTimeRange>(() => ({
    from: new Date(Date.now() - 60 * 60 * 1000),
    to: new Date(),
  }));

  // Instant values (shape=0 CURRENT)
  const {
    data: currentData,
    isLoading: currentLoading,
    error,
  } = useResourceMetrics({
    pluginID: PLUGIN_ID,
    connectionID,
    resourceKey,
    resourceID,
    resourceData,
    refreshInterval: 30000,
  });

  // Time-series data (shape=1 TIMESERIES)
  const { data: tsData, isLoading: tsLoading } = useResourceMetrics({
    pluginID: PLUGIN_ID,
    connectionID,
    resourceKey,
    resourceID,
    resourceData,
    shape: 1,
    timeRange: {
      start: timeRange.from,
      end: timeRange.to,
      step: '',
    },
    metricIDs: [
      'prom_cpu_utilization',
      'prom_memory_utilization',
      'prom_network_receive_rate',
      'prom_network_transmit_rate',
      'prom_disk_utilization',
      'prom_load_avg_1m',
      'prom_load_avg_5m',
      'prom_load_avg_15m',
      'prom_pod_count',
      'prom_disk_read_rate',
      'prom_disk_write_rate',
      'prom_network_errors',
      'prom_context_switches',
    ],
    refreshInterval: 30000,
  });

  const metrics = useMemo(() => extractCurrentMetrics(currentData), [currentData]);
  const tsSeries = useMemo(() => extractTimeSeries(tsData), [tsData]);

  const isLoading = currentLoading && metrics.size === 0;
  const hasTimeSeries = tsSeries.size > 0;

  // Build chart series
  const cpuSeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const cpu = tsSeries.get('prom_cpu_utilization');
    if (cpu) s.push(toTimeSeriesDef(cpu, 'CPU Utilization', 'var(--ov-color-brand-500)'));
    return s;
  }, [tsSeries]);

  const memorySeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const mem = tsSeries.get('prom_memory_utilization');
    if (mem) s.push(toTimeSeriesDef(mem, 'Memory Utilization', 'var(--ov-color-brand-500)'));
    return s;
  }, [tsSeries]);

  const networkSeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const rx = tsSeries.get('prom_network_receive_rate');
    if (rx) s.push(toTimeSeriesDef(rx, 'Receive', 'var(--ov-color-success)'));
    const tx = tsSeries.get('prom_network_transmit_rate');
    if (tx) s.push(toTimeSeriesDef(tx, 'Transmit', 'var(--ov-color-warning)'));
    return s;
  }, [tsSeries]);

  const diskUtilSeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const d = tsSeries.get('prom_disk_utilization');
    if (d) s.push(toTimeSeriesDef(d, 'Disk Utilization', 'var(--ov-color-discovery)'));
    return s;
  }, [tsSeries]);

  const diskIOSeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const r = tsSeries.get('prom_disk_read_rate');
    if (r) s.push(toTimeSeriesDef(r, 'Read', 'var(--ov-color-success)'));
    const w = tsSeries.get('prom_disk_write_rate');
    if (w) s.push(toTimeSeriesDef(w, 'Write', 'var(--ov-color-warning)'));
    return s;
  }, [tsSeries]);

  const loadAvgSeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const l1 = tsSeries.get('prom_load_avg_1m');
    if (l1) s.push(toTimeSeriesDef(l1, '1m', 'var(--ov-color-info)'));
    const l5 = tsSeries.get('prom_load_avg_5m');
    if (l5) s.push(toTimeSeriesDef(l5, '5m', 'var(--ov-color-warning)'));
    const l15 = tsSeries.get('prom_load_avg_15m');
    if (l15) s.push(toTimeSeriesDef(l15, '15m', 'var(--ov-color-discovery)'));
    return s;
  }, [tsSeries]);

  const podCountSeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const p = tsSeries.get('prom_pod_count');
    if (p) s.push(toTimeSeriesDef(p, 'Pod Count', 'var(--ov-color-brand-500)'));
    return s;
  }, [tsSeries]);

  const systemActivitySeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const cs = tsSeries.get('prom_context_switches');
    if (cs) s.push(toTimeSeriesDef(cs, 'Context Switches', 'var(--ov-color-info)'));
    const ne = tsSeries.get('prom_network_errors');
    if (ne) s.push(toTimeSeriesDef(ne, 'Network Errors', 'var(--ov-color-danger)'));
    return s;
  }, [tsSeries]);

  const handleTimeRangeChange = useCallback((range: ChartTimeRange) => {
    setTimeRange(range);
  }, []);

  if (isLoading) {
    return (
      <div style={loadingBoxStyle}>
        <Spinner size="sm" />
      </div>
    );
  }

  if (metrics.size === 0 && !hasTimeSeries && !error) {
    return (
      <div style={outerBoxStyle}>
        <div style={noMetricsHeaderStyle}>
          <Text weight="semibold" size="sm">
            Metrics
          </Text>
        </div>
        <div style={noMetricsBodyStyle}>
          <Text size="xs" tone="subtle">
            No metrics available. Ensure metrics-server or Prometheus is installed.
          </Text>
        </div>
      </div>
    );
  }

  // Extract known current metrics with defaults
  const cpuUsage = metrics.get('cpu_usage') ?? 0;
  const cpuUtilPct = metrics.get('prom_cpu_utilization');
  const memUsage = metrics.get('memory_usage') ?? 0;
  const memUtilPct = metrics.get('prom_memory_utilization');
  const memTotal = metrics.get('prom_memory_total');
  const diskUtilPct = metrics.get('prom_disk_utilization');
  const diskTotal = metrics.get('prom_disk_total');
  const netRx = metrics.get('prom_network_receive_rate');
  const netTx = metrics.get('prom_network_transmit_rate');
  const loadAvg = metrics.get('prom_load_avg_1m');
  const podCount = metrics.get('prom_pod_count');

  const hasPrometheus = cpuUtilPct !== undefined;

  return (
    <div style={outerBoxStyle}>
      {/* Header */}
      <div style={metricsHeaderStyle}>
        <Text weight="semibold" size="sm">
          Metrics
        </Text>
        {(currentLoading || tsLoading) && <Spinner size="xs" />}
      </div>

      {error && (
        <div style={errorBoxStyle}>
          <Text size="xs" tone="danger">
            {error.message || 'Failed to load metrics'}
          </Text>
        </div>
      )}

      <div style={metricsContentStyle}>
        <Stack direction="column" spacing={0} style={{ gap: 6 }}>
          {/* Time-series charts */}
          {hasTimeSeries && (
            <>
              {cpuSeries.length > 0 && (
                <MetricsPanel
                  title="CPU Utilization"
                  series={cpuSeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="percent"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
              {memorySeries.length > 0 && (
                <MetricsPanel
                  title="Memory Utilization"
                  series={memorySeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="percent"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
              {networkSeries.length > 0 && (
                <MetricsPanel
                  title="Network"
                  series={networkSeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="bytes"
                  unit="/s"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
              {diskUtilSeries.length > 0 && (
                <MetricsPanel
                  title="Disk Utilization"
                  series={diskUtilSeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="percent"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
              {diskIOSeries.length > 0 && (
                <MetricsPanel
                  title="Disk I/O"
                  series={diskIOSeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="bytes"
                  unit="/s"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
              {loadAvgSeries.length > 0 && (
                <MetricsPanel
                  title="Load Average"
                  series={loadAvgSeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="number"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
              {podCountSeries.length > 0 && (
                <MetricsPanel
                  title="Pod Count"
                  series={podCountSeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="number"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
              {systemActivitySeries.length > 0 && (
                <MetricsPanel
                  title="System Activity"
                  series={systemActivitySeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="number"
                  unit="/s"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
            </>
          )}

          {/* Utilization gauges (instant values) — shown when no charts available */}
          {hasPrometheus && !hasTimeSeries && (
            <div style={sectionPaddingStyle}>
              <Text size="xs" weight="semibold" tone="muted" style={sectionSubheadingStyle}>
                Utilization
              </Text>
              <Stack direction="column" spacing={0} style={{ gap: 6 }}>
                {cpuUtilPct !== undefined && <PercentGauge label="CPU" value={cpuUtilPct} />}
                {memUtilPct !== undefined && (
                  <PercentGauge
                    label="Memory"
                    value={memUtilPct}
                    subtitle={memTotal !== undefined ? `of ${formatBytes(memTotal)}` : undefined}
                  />
                )}
                {diskUtilPct !== undefined && (
                  <PercentGauge
                    label="Disk"
                    value={diskUtilPct}
                    subtitle={diskTotal !== undefined ? `of ${formatBytes(diskTotal)}` : undefined}
                  />
                )}
              </Stack>
            </div>
          )}

          {/* Metrics-server CPU/Memory */}
          {(cpuUsage > 0 || memUsage > 0) && (
            <div style={sectionPaddingStyle}>
              <Text size="xs" weight="semibold" tone="muted" style={sectionSubheadingAltStyle}>
                {hasPrometheus ? 'Current Usage' : 'Usage'}
              </Text>
              <div style={tileGridStyle}>
                {cpuUsage > 0 && (
                  <StatTile
                    label="CPU"
                    value={
                      cpuUsage >= 1000
                        ? `${(cpuUsage / 1000).toFixed(2)} cores`
                        : `${Math.round(cpuUsage)}m`
                    }
                  />
                )}
                {memUsage > 0 && (
                  <StatTile label="Memory" value={formatBytes(memUsage)} />
                )}
              </div>
            </div>
          )}

          {/* Network stats (instant, when no charts) */}
          {!hasTimeSeries && (netRx !== undefined || netTx !== undefined) && (
            <div style={sectionPaddingStyle}>
              <Text size="xs" weight="semibold" tone="muted" style={sectionSubheadingAltStyle}>
                Network
              </Text>
              <div style={tileGridStyle}>
                {netRx !== undefined && (
                  <StatTile label="Receive" value={formatBytesPerSec(netRx)} />
                )}
                {netTx !== undefined && (
                  <StatTile label="Transmit" value={formatBytesPerSec(netTx)} />
                )}
              </div>
            </div>
          )}

          {/* System stats */}
          {(loadAvg !== undefined || podCount !== undefined) && (
            <div style={sectionPaddingStyle}>
              <Text size="xs" weight="semibold" tone="muted" style={sectionSubheadingAltStyle}>
                System
              </Text>
              <div style={tileGridStyle}>
                {loadAvg !== undefined && (
                  <StatTile label="Load (1m)" value={loadAvg.toFixed(2)} />
                )}
                {podCount !== undefined && (
                  <StatTile label="Pods" value={String(Math.round(podCount))} />
                )}
              </div>
            </div>
          )}
        </Stack>
      </div>
    </div>
  );
};

export default NodeMetricsSection;
