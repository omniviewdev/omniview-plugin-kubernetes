import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import { DrawerComponentView, DrawerContext, useResourceMetrics } from '@omniviewdev/runtime';
import { MetricsPanel } from '@omniviewdev/ui/charts';
import type { TimeSeriesDef, ChartTimeRange } from '@omniviewdev/ui/charts';
import { TimeRangePicker } from '@omniviewdev/ui/inputs';
import type { TimeRange } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React, { useState, useMemo, useCallback } from 'react';
import { LuActivity } from 'react-icons/lu';

import { useClusterPreferences } from '../../../../../../hooks/useClusterPreferences';

import {
  CHART_COLORS,
  pageRootSx,
  noProvidersSx,
  noProvidersTextSx,
  loadingSx,
  noDataSx,
  noDataTextSx,
  errorBannerSx,
  errorTextSx,
  refreshBarSx,
  chartsGridSx,
  tileGroupWrapperSx,
  tileCategoryLabelSx,
  percentGaugeStackSx,
  timeRangePickerSx,
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

  const { connectionOverrides } = useClusterPreferences('kubernetes');
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
    pluginID: 'kubernetes',
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
  const { data: tsData, isLoading: tsLoading } = useResourceMetrics({
    pluginID: 'kubernetes',
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

  // Bridge TimeRange <-> ChartTimeRange (same shape, different type names)
  const handlePickerChange = useCallback((range: TimeRange) => {
    setTimeRange({ from: range.from, to: range.to });
  }, []);

  const isLoading = currentLoading && currentValues.size === 0;
  const hasAnyData = currentValues.size > 0 || tsSeries.size > 0;
  const noProviders = !currentLoading && providers.length === 0;
  const noData = !hasAnyData && !error && !isLoading;

  // Zero early returns — every render must call the same hooks.
  return (
    <Box sx={pageRootSx}>
      {/* No providers */}
      {noProviders && (
        <Box sx={noProvidersSx}>
          <Text size="sm" sx={noProvidersTextSx}>
            No metric providers registered for this resource type.
          </Text>
        </Box>
      )}

      {/* Loading initial data */}
      {isLoading && (
        <Box sx={loadingSx}>
          <CircularProgress size={24} />
        </Box>
      )}

      {/* No data message */}
      {noData && (
        <Box sx={noDataSx}>
          <Text size="sm" sx={noDataTextSx}>
            No metrics available. Ensure metrics-server or Prometheus is installed in the cluster.
          </Text>
        </Box>
      )}

      {/* Error banner */}
      {error && (
        <Box sx={errorBannerSx}>
          <Text size="xs" sx={errorTextSx}>
            {error.message || 'Failed to load metrics'}
          </Text>
        </Box>
      )}

      {/* Refresh indicator */}
      {(currentLoading || tsLoading) && hasAnyData && (
        <LinearProgress sx={refreshBarSx} />
      )}

      {/* Main content — only when we have data */}
      {hasAnyData && (
        <>
          <TimeRangePicker value={timeRange} onChange={handlePickerChange} sx={timeRangePickerSx} />

          {/* Charts grid — 2-up when wide enough */}
          <Box sx={chartsGridSx}>
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
          </Box>

          {/* Tile-only metrics (instant values without time-series) */}
          {tileGroups.length > 0 && (
            <Stack spacing={0.75}>
              {tileGroups.map((group) => (
                <Box key={group.category} sx={tileGroupWrapperSx}>
                  <Text
                    size="xs"
                    weight="semibold"
                    sx={tileCategoryLabelSx}
                  >
                    {group.category}
                  </Text>

                  {group.metrics.some((m) => m.unit === 5) && (
                    <Stack spacing={0.75} sx={percentGaugeStackSx}>
                      {group.metrics
                        .filter((m) => m.unit === 5)
                        .map((m) => (
                          <PercentGauge key={m.id} label={m.name} value={m.value} />
                        ))}
                    </Stack>
                  )}

                  {group.metrics.some((m) => m.unit !== 5) && (
                    <Grid container spacing={0.5}>
                      {group.metrics
                        .filter((m) => m.unit !== 5)
                        .map((m) => {
                          const count = group.metrics.filter((x) => x.unit !== 5).length;
                          return (
                            <Grid key={m.id} size={count === 1 ? 12 : 6}>
                              <MetricTile label={m.name} value={formatValue(m.value, m.unit)} />
                            </Grid>
                          );
                        })}
                    </Grid>
                  )}
                </Box>
              ))}
            </Stack>
          )}
        </>
      )}
    </Box>
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
