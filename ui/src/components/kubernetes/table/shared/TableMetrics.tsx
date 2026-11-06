import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { MetricCell, type CapacityBound, type MetricThreshold } from '@omniviewdev/base-ui/metrics';
import { parseAppError, useMetricCatalog, useMetricObservation, useMetricViewSourceSelection, type HostRecord, type PreparedMetricResult, type ResourceMetricTarget, type UseMetricObservationOptions } from '@omniviewdev/runtime';
import type { ColumnDef } from '@tanstack/react-table';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { useDocumentVisibility } from '@/hooks/useDocumentVisibility';
import { PLUGIN_ID } from '@/pluginId';

type Scope = Pick<UseMetricObservationOptions, 'ownerConnectionID' | 'resourceKey' | 'bindingID' | 'source'>;
type MetricColumn = { id: string; metricID: string };
const ScopeContext = createContext<(Scope & { columns: MetricColumn[]; ready: boolean; loading?: boolean; error?: unknown }) | null>(null);
const ValuesContext = createContext<{
  metrics: ReadonlyMap<string, ReadonlyMap<string, PreparedMetricResult>>;
  register: (body: object) => () => void;
  tokenFor: (body: object) => string | undefined;
  error: unknown;
  loading: boolean;
} | null>(null);

/** Resource owners supply scope and default columns; generic tables only compose typed slots. */
export function useTableMetrics<T extends object>(scope: Scope, defaults: Readonly<Record<string, string>>, presentation?: {
  bound?: (body: T, metricID: string) => { bound?: CapacityBound; request?: number; thresholds?: readonly MetricThreshold[] };
  headers?: Readonly<Record<string, string>>;
}) {
  const selection = useMetricViewSourceSelection(PLUGIN_ID, scope.ownerConnectionID, scope.resourceKey);
  const source = useMemo(() => scope.source ?? (selection.selection?.mode === 'native'
    ? { plugin_id: PLUGIN_ID, connection_id: scope.ownerConnectionID, native: true, datasource_uid: '', datasource_kind: '' }
    : selection.selection?.mode === 'external' ? selection.selection.source : undefined),
  [scope.source, scope.ownerConnectionID, selection.selection]);
  const selectedScope = { ...scope, source };
  const sourceReady = !!selection.selection && !selection.isLoading && !selection.error
    && (selection.selection.mode !== 'external' || !!source);
  const catalog = useMetricCatalog({ ownerPluginID: PLUGIN_ID, ...selectedScope, enabled: sourceReady });
  const descriptors = catalog.data?.metrics;
  const metricColumns = useMemo(() => (descriptors ?? []).filter(metric => metric.shapes.includes('current')).map(metric => ({
    id: defaults[metric.id] ?? `metric:${metric.id}`, metricID: metric.id,
  })), [descriptors, defaults]);
  const columns = useMemo<Array<ColumnDef<DataTableFeatures, T>>>(() => metricColumns.map(column => ({
    id: column.id,
    header: presentation?.headers?.[column.metricID] ?? descriptors?.find(metric => metric.id === column.metricID)?.name ?? column.metricID,
    accessorFn: row => row,
    enableSorting: false,
    enableColumnFilter: false,
    size: 168,
    meta: { defaultHidden: !defaults[column.metricID] },
    cell: ({ row }) => <TableMetricCell body={row.original} metricID={column.metricID} {...presentation?.bound?.(row.original, column.metricID)} />,
  })), [metricColumns, descriptors, defaults, presentation]);
  const value = useMemo(() => ({ ownerConnectionID: scope.ownerConnectionID, resourceKey: scope.resourceKey,
    bindingID: scope.bindingID, source, columns: metricColumns, ready: sourceReady && !!catalog.data && !catalog.error && !catalog.isLoading,
    loading: selection.isLoading || catalog.isLoading, error: selection.error ?? catalog.error }),
    [scope.ownerConnectionID, scope.resourceKey, scope.bindingID, source, sourceReady, metricColumns, catalog.data, catalog.error, catalog.isLoading, selection.isLoading, selection.error]);
  return { columns, scope: value, error: selection.error ?? catalog.error };
}

export const TableMetricsScope = ScopeContext.Provider;

/** One observation owns all visible metric columns and mounted virtual row targets. */
export function TableMetricsProvider({ columnVisibility, recordsByBody, children }: PropsWithChildren<{
  columnVisibility: Record<string, boolean>;
  recordsByBody: WeakMap<object, HostRecord>;
}>) {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error('Metric table requires TableMetricsScope.');
  const visible = useDocumentVisibility();
  const [mounted, setMounted] = useState<ReadonlyMap<object, number>>(() => new Map());
  const register = useCallback((body: object) => {
    setMounted(previous => new Map(previous).set(body, (previous.get(body) ?? 0) + 1));
    return () => setMounted(previous => {
      const next = new Map(previous);
      const count = (next.get(body) ?? 1) - 1;
      if (count > 0) next.set(body, count);
      else next.delete(body);
      return next;
    });
  }, []);
  const targets = useMemo<ResourceMetricTarget[]>(() => Array.from(mounted.keys()).flatMap(body => {
    const record = recordsByBody.get(body);
    return record ? [{ token: record.key, reference: record.record.reference, route: record.route }] : [];
  }), [mounted, recordsByBody]);
  const metricIDs = useMemo(() => scope.columns.filter(column => columnVisibility[column.id] === true).map(column => column.metricID), [scope.columns, columnVisibility]);
  const observation = useMetricObservation({ ownerPluginID: PLUGIN_ID, ownerConnectionID: scope.ownerConnectionID,
    resourceKey: scope.resourceKey, bindingID: scope.bindingID, source: scope.source, targets, metricIDs,
    shape: 'current', intervalMs: 30_000,
    enabled: scope.ready && visible && metricIDs.length > 0 && targets.length > 0 && !!scope.ownerConnectionID });
  const metrics = useMemo(() => {
    const map = new Map<string, Map<string, PreparedMetricResult>>();
    for (const result of observation.results) {
      let values = map.get(result.resourceToken);
      if (!values) { values = new Map(); map.set(result.resourceToken, values); }
      values.set(result.metricID, result);
    }
    return map;
  }, [observation.results]);
  const tokenFor = useCallback((body: object) => recordsByBody.get(body)?.key, [recordsByBody]);
  const error = scope.error ?? observation.error;
  const loading = !!scope.loading || (scope.ready && !error && (targets.length === 0 || observation.isFetching));
  const value = useMemo(() => ({ metrics, register, tokenFor, error, loading }), [metrics, register, tokenFor, error, loading]);
  return <ValuesContext.Provider value={value}>{children}</ValuesContext.Provider>;
}

export function TableMetricCell({ body, metricID, bound, request, thresholds }: { body: object; metricID: string; bound?: CapacityBound; request?: number; thresholds?: readonly MetricThreshold[] }) {
  const context = useContext(ValuesContext);
  if (!context) throw new Error('Metric cells require TableMetricsProvider.');
  const { register, tokenFor, metrics, error, loading } = context;
  useEffect(() => register(body), [register, body]);
  const token = tokenFor(body);
  const result = token ? metrics.get(token)?.get(metricID) : undefined;
  const title = error ? parseAppError(error).detail : result?.status === 'ok'
    ? (result.observedAt == null ? undefined : `Observed ${new Date(result.observedAt).toLocaleString()}`) : result?.status;
  return <div title={title}>{result?.unit
    ? <MetricCell label={metricID} value={result.status === 'ok' ? result.value : null} unit={result.unit} bound={bound} request={request} thresholds={thresholds} />
    : loading && !error ? <MetricCell label={metricID} loading /> : '—'}</div>;
}
