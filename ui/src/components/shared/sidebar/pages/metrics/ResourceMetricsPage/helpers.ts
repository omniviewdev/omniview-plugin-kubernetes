import type { metric } from '@omniviewdev/runtime/models';
import type { TimeSeriesDef, MetricFormat } from '@omniviewdev/ui/charts';

import { CHART_COLORS, ICON_CATEGORIES, CATEGORY_ORDER } from './constants';
import { unitToFormat, unitToSuffix, unitToFormatter } from './formatters';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DescriptorMap = Map<string, metric.MetricDescriptor>;

export interface ChartDef {
  title: string;
  metricIDs: string[];
  labels: Record<string, string>;
  colors: Record<string, string>;
  valueFormat: MetricFormat;
  valueFormatter?: (v: number | null) => string;
  unit?: string;
}

export type TileGroup = {
  category: string;
  metrics: { id: string; name: string; value: number; unit: number }[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function collectDescriptors(providers: metric.MetricProviderSummary[]): DescriptorMap {
  const map: DescriptorMap = new Map();
  for (const provider of providers) {
    for (const handler of provider.handlers ?? []) {
      for (const desc of handler.metrics ?? []) {
        if (desc.id) map.set(desc.id, desc);
      }
    }
  }
  return map;
}

/** Returns the set of metric IDs that support time-series (shape=1). */
export function getTimeSeriesMetricIDs(descriptors: DescriptorMap): Set<string> {
  const ids = new Set<string>();
  for (const [id, desc] of descriptors) {
    if (desc.supported_shapes?.includes(1)) {
      ids.add(id);
    }
  }
  return ids;
}

export function extractCurrentValues(
  data: Record<string, metric.QueryResponse> | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!data) return out;
  for (const resp of Object.values(data)) {
    if (!resp?.success || !resp.results) continue;
    for (const result of resp.results) {
      if (result.current_value) {
        out.set(result.current_value.metric_id, result.current_value.value);
      }
    }
  }
  return out;
}

export function extractTimeSeries(
  data: Record<string, metric.QueryResponse> | undefined,
): Map<string, metric.TimeSeries> {
  const out = new Map<string, metric.TimeSeries>();
  if (!data) return out;
  for (const resp of Object.values(data)) {
    if (!resp?.success || !resp.results) continue;
    for (const result of resp.results) {
      if (result.time_series?.metric_id) {
        out.set(result.time_series.metric_id, result.time_series);
      }
    }
  }
  return out;
}

export function toTimeSeriesDef(
  ts: metric.TimeSeries,
  label: string,
  color: string,
  opts?: { area?: boolean; lineStyle?: 'solid' | 'dashed' | 'dotted' },
): TimeSeriesDef {
  return {
    id: ts.metric_id,
    label,
    data: (ts.data_points ?? []).map((dp) => ({
      timestamp: new Date(dp.timestamp as unknown as string).getTime(),
      value: dp.value,
    })),
    color,
    area: opts?.area ?? true,
    lineStyle: opts?.lineStyle,
  };
}

// ---------------------------------------------------------------------------
// Data-driven chart building from descriptors
// ---------------------------------------------------------------------------

/**
 * Build chart definitions dynamically from descriptor metadata.
 * Metrics sharing the same `chart_group` value are rendered on the same chart.
 * The group value is used as the chart title.
 */
export function buildChartsFromDescriptors(
  descriptors: DescriptorMap,
  tsSeries: Map<string, metric.TimeSeries>,
): ChartDef[] {
  const groupMap = new Map<string, { descs: metric.MetricDescriptor[]; hasData: boolean }>();

  for (const [id, desc] of descriptors) {
    if (!desc.chart_group || !desc.supported_shapes?.includes(1)) continue;
    let group = groupMap.get(desc.chart_group);
    if (!group) {
      group = { descs: [], hasData: false };
      groupMap.set(desc.chart_group, group);
    }
    group.descs.push(desc);
    if (tsSeries.has(id)) group.hasData = true;
  }

  return [...groupMap.entries()]
    .filter(([, g]) => g.hasData)
    .map(([title, g]) => ({
      title,
      metricIDs: g.descs.map((d) => d.id),
      labels: Object.fromEntries(g.descs.map((d) => [d.id, d.name])),
      colors: Object.fromEntries(
        g.descs.map((d, i) => [d.id, CHART_COLORS[i % CHART_COLORS.length]]),
      ),
      valueFormat: unitToFormat(g.descs[0].unit),
      valueFormatter: unitToFormatter(g.descs[0].unit),
      unit: unitToSuffix(g.descs[0].unit),
    }));
}

// ---------------------------------------------------------------------------
// Tile grouping
// ---------------------------------------------------------------------------

export function buildTileGroups(
  values: Map<string, number>,
  chartMetricIDs: Set<string>,
  descriptors: DescriptorMap,
): TileGroup[] {
  const groups = new Map<string, TileGroup['metrics']>();

  for (const [metricId, value] of values) {
    // Skip metrics that are rendered as charts
    if (chartMetricIDs.has(metricId)) continue;

    const desc = descriptors.get(metricId);
    const category = desc?.icon ? (ICON_CATEGORIES[desc.icon] ?? 'Other') : 'Other';

    let list = groups.get(category);
    if (!list) {
      list = [];
      groups.set(category, list);
    }
    list.push({
      id: metricId,
      name: desc?.name || metricId,
      value,
      unit: desc?.unit ?? 0,
    });
  }

  return CATEGORY_ORDER.filter((cat) => groups.has(cat)).map((cat) => ({
    category: cat,
    metrics: groups.get(cat)!,
  }));
}
