import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { MetricCell, type CapacityBound, type MetricReference, type MetricThreshold } from '@omniviewdev/base-ui/metrics';
import { parseAppError, useMetricCatalog, useTableMetricObservation, useMetricViewSourceSelection, type HostRecord, type TableMetricObservation, type UseMetricObservationOptions } from '@omniviewdev/runtime';
import type { ColumnDef } from '@tanstack/react-table';
import { createContext, useContext, useEffect, useMemo, type PropsWithChildren } from 'react';

import { PLUGIN_ID } from '@/pluginId';

type Scope = Pick<UseMetricObservationOptions, 'ownerConnectionID' | 'resourceKey' | 'bindingID' | 'source'>;
type MetricColumn = { id: string; metricID: string };
const ScopeContext = createContext<(Scope & { columns: MetricColumn[]; ready: boolean; loading?: boolean; error?: unknown }) | null>(null);
const ValuesContext = createContext<TableMetricObservation | null>(null);

/** Resource owners supply scope and default columns; generic tables only compose typed slots. */
export function useTableMetrics<T extends object>(scope: Scope, defaults: Readonly<Record<string, string>>, presentation?: {
  cell?: (body: T, metricID: string) => { bound?: CapacityBound; references?: readonly MetricReference[]; thresholds?: readonly MetricThreshold[] };
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
    cell: ({ row }) => <TableMetricCell body={row.original} metricID={column.metricID} {...presentation?.cell?.(row.original, column.metricID)} />,
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
  const metricIDs = useMemo(() => scope.columns.filter(column => columnVisibility[column.id] === true).map(column => column.metricID), [scope.columns, columnVisibility]);
  const value = useTableMetricObservation({ ownerPluginID: PLUGIN_ID, ownerConnectionID: scope.ownerConnectionID,
    resourceKey: scope.resourceKey, bindingID: scope.bindingID, source: scope.source, recordsByBody, metricIDs,
    enabled: scope.ready, loading: scope.loading, error: scope.error });
  return <ValuesContext.Provider value={value}>{children}</ValuesContext.Provider>;
}

/**
 * A known sample always renders, so a refresh never blanks it. Without one, the cell holds a
 * placeholder only while its own sample is pending. A failure, or a sample that settled without
 * data, leaves a static gap; a failure also puts its detail in the tooltip.
 */
export function TableMetricCell({ body, metricID, bound, references, thresholds }: { body: object; metricID: string; bound?: CapacityBound; references?: readonly MetricReference[]; thresholds?: readonly MetricThreshold[] }) {
  const context = useContext(ValuesContext);
  if (!context) throw new Error('Metric cells require TableMetricsProvider.');
  const { register, tokenFor, metrics, error, isLoadingFor } = context;
  useEffect(() => register(body), [register, body]);
  const token = tokenFor(body);
  const result = token ? metrics.get(token)?.get(metricID) : undefined;
  const title = error ? parseAppError(error).detail : result?.status === 'ok'
    ? (result.observedAt == null ? undefined : `Observed ${new Date(result.observedAt).toLocaleString()}`) : result?.status;
  return <div title={title} style={{ width: '100%', minWidth: 0 }}>{result?.unit
    ? <MetricCell label={metricID} value={result.status === 'ok' ? result.value : null} unit={result.unit} bound={bound} references={references} thresholds={thresholds} />
    : !error && isLoadingFor(body, metricID) ? <MetricCell label={metricID} loading /> : '—'}</div>;
}
