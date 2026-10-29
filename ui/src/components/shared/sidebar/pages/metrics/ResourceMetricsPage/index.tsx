import { Progress, Spinner, Stack, Text } from '@omniviewdev/base-ui';
import { DrawerComponentView, DrawerContext, useResourceMetrics } from '@omniviewdev/runtime';
import React, { useState, useMemo } from 'react';
import { LuActivity } from 'react-icons/lu';

import { PLUGIN_ID } from '@/pluginId';

import { useClusterPreferences } from '../../../../../../hooks/useClusterPreferences';
import { MetricsPanel, TimeRangePicker } from '../../../../charts';
import type { TimeSeriesDef, ChartTimeRange } from '../../../../charts';

import {
  CHART_COLORS,
  pageRootStyle,
  noProvidersStyle,
  loadingStyle,
  noDataStyle,
  errorBannerStyle,
  refreshBarStyle,
  chartsGridStyle,
  tileGroupWrapperStyle,
  tileCategoryLabelStyle,
  percentGaugeStackStyle,
  timeRangePickerStyle,
  tileGridStyle,
} from './constants';
import { formatValue } from './formatters';
import {
  collectDescriptors,
  getTimeSeriesMetricIDs,
  extractCurrentValues,
  extractTimeSeries,
  toTimeSeriesDef,
  buildChartsFromDescriptors,
  buildTileGroups,
} from './helpers';
import MetricTile from './MetricTile';
import PercentGauge from './PercentGauge';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  ctx: DrawerContext<Record<string, unknown>>;
}

const ResourceMetricsPage: React.FC<Props> = ({ ctx }) => {
  const resourceKey = ctx.resource?.key || '';
  const connectionID = ctx.resource?.connectionID || '';
  const resourceID = ctx.resource?.id || '';
  const metadata = (ctx.data)?.metadata as Record<string, unknown> | undefined;
  const resourceNamespace = (metadata?.namespace as string) ?? '';

  const { connectionOverrides } = useClusterPreferences(PLUGIN_ID);
  const metricConfig = connectionOverrides[connectionID]?.metricConfig;

  const enrichedData = useMemo(() => {
    const base = (ctx.data ?? {});
    if (
      !metricConfig?.prometheusService &&
      !metricConfig?.prometheusNamespace &&
      !metricConfig?.prometheusPort
    ) {
      return base;
    }
    return {
      ...base,
      __metric_config__: {
        service: metricConfig.prometheusService || '',
        namespace: metricConfig.prometheusNamespace || '',
        port: metricConfig.prometheusPort || 0,
      },
    };
  }, [ctx.data, metricConfig]);

  // Time range state for charts (shared across all panels)
  const [timeRange, setTimeRange] = useState<ChartTimeRange>(() => ({
    from: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
    to: new Date(),
  }));

  // Instant values (shape=0) for tiles and current value display
  const {
    data: currentData,
    providers,
    isLoading: currentLoading,
    error,
  } = useResourceMetrics({
    pluginID: PLUGIN_ID,
    connectionID,
    resourceKey,
    resourceID,
    resourceNamespace,
    resourceData: enrichedData,
    refreshInterval: 30000,
  });

  const descriptors = useMemo(() => collectDescriptors(providers), [providers]);
  const tsMetricIDs = useMemo(() => getTimeSeriesMetricIDs(descriptors), [descriptors]);
  const tsMetricIDList = useMemo(() => [...tsMetricIDs], [tsMetricIDs]);

  // Time-series query (shape=1) - only if descriptors declare time-series support
  const { data: tsData, isLoading: tsLoading, error: tsError } = useResourceMetrics({
    pluginID: PLUGIN_ID,
    connectionID,
    resourceKey,
    resourceID,
    resourceNamespace,
    resourceData: enrichedData,
    shape: 1,
    timeRange: {
      start: timeRange.from,
      end: timeRange.to,
      step: '',
    },
    metricIDs: tsMetricIDList,
    refreshInterval: 30000,
    enabled: tsMetricIDList.length > 0,
  });

  const currentValues = useMemo(() => extractCurrentValues(currentData), [currentData]);
  const tsSeries = useMemo(() => extractTimeSeries(tsData), [tsData]);

  // Build charts dynamically from descriptor chart_group metadata
  const charts = useMemo(
    () => buildChartsFromDescriptors(descriptors, tsSeries),
    [descriptors, tsSeries],
  );

  // Collect all metric IDs that belong to a chart_group (exclude from tiles)
  const chartMetricIDs = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, desc] of descriptors) {
      if (desc.chart_group) ids.add(id);
    }
    return ids;
  }, [descriptors]);

  const tileGroups = useMemo(
    () => buildTileGroups(currentValues, chartMetricIDs, descriptors),
    [currentValues, chartMetricIDs, descriptors],
  );

  const isLoading = currentLoading && currentValues.size === 0;
  const hasAnyData = currentValues.size > 0 || tsSeries.size > 0;
  const noProviders = !currentLoading && providers.length === 0;
  const noData = !hasAnyData && !error && !isLoading;

  // Zero early returns — every render must call the same hooks.
  return (
    <div style={pageRootStyle}>
      {/* No providers */}
      {noProviders && (
        <div style={noProvidersStyle}>
          <Text size="sm" tone="subtle">
            No metric providers registered for this resource type.
          </Text>
        </div>
      )}

      {/* Loading initial data */}
      {isLoading && (
        <div style={loadingStyle}>
          <Spinner size="md" />
        </div>
      )}

      {/* No data message */}
      {noData && (
        <div style={noDataStyle}>
          <Text size="sm" tone="subtle">
            No metrics available. Ensure metrics-server or Prometheus is installed in the cluster.
          </Text>
        </div>
      )}

      {/* Error banner */}
      {(error || tsError) && (
        <div style={errorBannerStyle}>
          <Text size="xs" tone="danger">
            {(error ?? tsError)?.message || 'Failed to load metrics'}
          </Text>
        </div>
      )}

      {/* Refresh indicator */}
      {(currentLoading || tsLoading) && hasAnyData && (
        <Progress size="xs" aria-label="Refreshing metrics" style={refreshBarStyle} />
      )}

      {/* Main content — only when we have data */}
      {hasAnyData && (
        <>
          <TimeRangePicker value={timeRange} onChange={setTimeRange} style={timeRangePickerStyle} />

          {/* Charts grid — 2-up when wide enough */}
          <div style={chartsGridStyle}>
            {charts.map((def) => {
              const series: TimeSeriesDef[] = [];

              for (const id of def.metricIDs) {
                const ts = tsSeries.get(id);
                if (!ts) continue;
                series.push(
                  toTimeSeriesDef(
                    ts,
                    def.labels[id] || id,
                    def.colors[id] || CHART_COLORS[series.length % CHART_COLORS.length],
                  ),
                );
              }

              return (
                <MetricsPanel
                  key={def.title}
                  title={def.title}
                  series={series}
                  timeRange={timeRange}
                  valueFormat={def.valueFormat}
                  valueFormatter={def.valueFormatter}
                  unit={def.unit}
                  area
                  variant="default"
                  height={200}
                />
              );
            })}
          </div>

          {/* Tile-only metrics (instant values without time-series) */}
          {tileGroups.length > 0 && (
            <Stack direction="column" spacing={0} style={{ gap: 6 }}>
              {tileGroups.map((group) => (
                <div key={group.category} style={tileGroupWrapperStyle}>
                  <Text size="xs" weight="semibold" tone="muted" style={tileCategoryLabelStyle}>
                    {group.category}
                  </Text>

                  {group.metrics.some((m) => m.unit === 5) && (
                    <Stack direction="column" spacing={0} style={percentGaugeStackStyle}>
                      {group.metrics
                        .filter((m) => m.unit === 5)
                        .map((m) => (
                          <PercentGauge key={m.id} label={m.name} value={m.value} />
                        ))}
                    </Stack>
                  )}

                  {group.metrics.some((m) => m.unit !== 5) && (
                    <div style={tileGridStyle}>
                      {group.metrics
                        .filter((m) => m.unit !== 5)
                        .map((m) => {
                          const count = group.metrics.filter((x) => x.unit !== 5).length;
                          return (
                            <div key={m.id} style={{ gridColumn: `span ${count === 1 ? 12 : 6}` }}>
                              <MetricTile label={m.name} value={formatValue(m.value, m.unit)} />
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              ))}
            </Stack>
          )}
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

// eslint-disable-next-line react-refresh/only-export-components
export function createMetricsView(): DrawerComponentView<Record<string, unknown>> {
  return {
    title: 'Metrics',
    icon: <LuActivity />,
    component: (ctx) => <ResourceMetricsPage ctx={ctx} />,
  };
}

export default ResourceMetricsPage;
