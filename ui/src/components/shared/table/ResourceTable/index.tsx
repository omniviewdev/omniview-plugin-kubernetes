import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import { useResources, DrawerComponent } from '@omniviewdev/runtime';
import { Skeleton } from '@omniviewdev/ui/feedback';
import {
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnSizingState,
  type SortingState,
  type VisibilityState,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table';
import get from 'lodash.get';
import React, { useMemo, useState } from 'react';

const SKELETON_ROW_COUNT = 8;

import type { KubernetesResourceObject } from '../../../../types/resource';
import { plural } from '../../../../utils/language';
import { useDynamicResourceColumns } from '../../../tables/ColumnFilter/useDynamicResourceColumns';

import ResourceTableBody from '../ResourceTableBody';
import { TableDrawerContext } from '../TableDrawerContext';
import { ColumnMeta } from '../types';
import { useColumnSizeVars } from '../useColumnSizeVars';
import { useRowSelectionCleanup } from '../useRowSelectionCleanup';
import { useConnectionNamespaces } from '@/hooks/useConnectionNamespaces';
import { useStoredState } from '@/hooks/useStoredState';

import ResourceTableErrorState from './ResourceTableErrorState';
import ResourceTableHeader from './ResourceTableHeader';
import ResourceTableToolbar from './ResourceTableToolbar';
import {
  tableOuterSx,
  tableWrapperRelativeSx,
  syncIndicatorSx,
  skeletonSx,
  TableWrapper,
  ScrollContainer,
  StyledTable,
} from './styles';

export type Memoizer = string | string[] | ((data: KubernetesResourceObject) => string);

export type ToolbarFilterDef = {
  /** TanStack column ID this filter targets. */
  columnId: string;
  /** Placeholder shown when nothing is selected (e.g. "All Nodes"). */
  placeholder: string;
  /** Extracts the filterable string value from a raw data row for building dropdown options. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  accessor: (row: any) => string | undefined;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic component that accepts multiple row data types (Pod, HelmChart, etc.)
export type Props<T = any> = {
  connectionID: string;
  resourceKey: string;
  columns: Array<ColumnDef<T> & ColumnMeta>;
  idAccessor: string;
  memoizer?: Memoizer;
  drawer?: DrawerComponent;
  /** Hide the namespace selector (for non-namespaced resources like Helm Charts) */
  hideNamespaceSelector?: boolean;
  /** Optional toolbar actions rendered to the right of the search bar */
  toolbarActions?: React.ReactNode;
  /** Show a "Create" button in the toolbar. Defaults to true. */
  createEnabled?: boolean;
  /**
   * Per-resource filter dropdowns rendered in the toolbar. When provided, these
   * replace the default NamespaceSelect with N dropdowns in the given order
   * (left → right). A filter with columnId "namespace" routes its state through
   * the shared useConnectionNamespaces hook so all tables stay in sync.
   */
  toolbarFilters?: ToolbarFilterDef[];
};

const visibilityFromColumnDefs = <T,>(defs: Array<ColumnDef<T>>): VisibilityState => {
  const visibility: VisibilityState = {};
  defs.forEach((def) => {
    let meta = (def?.meta as { defaultHidden?: boolean }) || undefined;
    if (meta === undefined) {
      meta = {};
    }
    if (def.id && meta?.defaultHidden !== undefined) {
      visibility[def.id] = !meta.defaultHidden;
    }
  });
  return visibility;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Empty array used as fallback for resources.data?.result which is any[]
const defaultData: any[] = [];

const ResourceTableContainer: React.FC<Props> = ({
  connectionID,
  resourceKey,
  columns,
  memoizer,
  drawer,
  hideNamespaceSelector,
  toolbarActions,
  createEnabled = true,
  toolbarFilters,
}) => {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnVisibility, setColumnVisibility] = useStoredState<VisibilityState>(
    `kubernetes-${connectionID}-${resourceKey}-column-visibility`,
    visibilityFromColumnDefs(columns),
  );
  const [columnFilters, setColumnFilters] = useStoredState<ColumnFiltersState>(
    `kubernetes-${connectionID}-${resourceKey}-column-filters`,
    [],
  );
  const [columnSizing, setColumnSizing] = useStoredState<ColumnSizingState>(
    `kubernetes-${connectionID}-${resourceKey}-column-sizing`,
    {},
  );
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [search, setSearch] = useState<string>('');

  // Shared per-connection namespace selection
  const { namespaces: sharedNamespaces, setNamespaces: setSharedNamespaces } =
    useConnectionNamespaces(connectionID);

  // Per-resource filter values for non-namespace toolbar filters
  const [extraFilterValues, setExtraFilterValues] = useStoredState<Record<string, string[]>>(
    `kubernetes-${connectionID}-${resourceKey}-toolbar-filter-values`,
    {},
  );

  /** Filtering behavior */
  const [filterAnchor, setFilterAnchor] = React.useState<undefined | HTMLElement>(undefined);
  const handleFilterClick = (event: React.MouseEvent<HTMLElement>) => {
    setFilterAnchor(filterAnchor ? undefined : event.currentTarget);
  };
  const handleFilterClose = () => {
    setFilterAnchor(undefined);
  };

  const { resources, isSyncing } = useResources({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey,
    idAccessor: 'metadata.uid',
  });

  // Prune stale entries from rowSelection when resources are deleted (e.g. during
  // rolling updates). Orphaned UIDs in rowSelection cause the header "select all"
  // checkbox and per-row checkboxes to desync from the actual row highlight state.
  useRowSelectionCleanup(
    resources.data?.result || defaultData,
    'metadata.uid',
    setRowSelection,
  );

  const showSyncingIndicator = isSyncing && (resources.data?.result?.length ?? 0) > 0;
  const { labels, setLabels, annotations, setAnnotations, columnDefs } = useDynamicResourceColumns({
    connectionID,
    resourceKey,
  });

  const handleLabels = (vals: Record<string, boolean>) => {
    setLabels((prev: Record<string, boolean>) => ({ ...prev, ...vals }));
  };

  const handleAnnotations = (vals: Record<string, boolean>) => {
    setAnnotations((prev: Record<string, boolean>) => ({ ...prev, ...vals }));
  };

  const allColumns = [...columns, ...columnDefs] as ColumnDef<KubernetesResourceObject, any>[];

  // Auto-detect whether this resource has a namespace column
  const hasNamespaceColumn = allColumns.some((col) => col.id === 'namespace');

  // Merge shared namespace selection + toolbar extra filters into TanStack column filters
  const effectiveColumnFilters = useMemo<ColumnFiltersState>(() => {
    // Start with per-resource filters, excluding namespace (managed by shared hook)
    let filters = columnFilters.filter((f) => f.id !== 'namespace');

    // Inject shared namespace filter
    if (hasNamespaceColumn && sharedNamespaces.length > 0) {
      filters = [...filters, { id: 'namespace', value: sharedNamespaces }];
    }

    // Inject toolbar extra filter values (skip namespace — already handled above)
    for (const [colId, values] of Object.entries(extraFilterValues)) {
      if (colId === 'namespace' || !values.length) continue;

      // Restrict merging to only those extraFilterValues whose colId is currently defined in the active toolbar filters
      if (toolbarFilters && !toolbarFilters.some((f) => f.columnId === colId)) continue;

      filters = filters.filter((f) => f.id !== colId);
      filters.push({ id: colId, value: values });
    }

    return filters;
  }, [columnFilters, sharedNamespaces, hasNamespaceColumn, extraFilterValues, toolbarFilters]);

  // Intercept onColumnFiltersChange to redirect namespace changes to the shared hook
  const handleColumnFiltersChange = React.useCallback(
    (updaterOrValue: ColumnFiltersState | ((prev: ColumnFiltersState) => ColumnFiltersState)) => {
      setColumnFilters((prev) => {
        const next = typeof updaterOrValue === 'function' ? updaterOrValue(prev) : updaterOrValue;
        // Extract namespace filter changes and route to shared state
        const nsFilter = next.find((f) => f.id === 'namespace');
        if (nsFilter) {
          setSharedNamespaces(nsFilter.value as string[]);
        }
        // Store only non-namespace filters per-resource
        return next.filter((f) => f.id !== 'namespace');
      });
    },
    [setColumnFilters, setSharedNamespaces],
  );

  const table = useReactTable({
    data: resources.data?.result || defaultData,
    columns: allColumns,
    columnResizeMode: 'onChange',
    onSortingChange: setSorting,
    onColumnFiltersChange: handleColumnFiltersChange,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: (row) => get(row, 'metadata.uid') as string,
    defaultColumn: {
      minSize: 40,
      maxSize: 800,
    },
    state: {
      sorting,
      columnFilters: effectiveColumnFilters,
      columnVisibility,
      columnSizing,
      rowSelection,
      globalFilter: search,
      columnPinning: { left: ['select'], right: ['menu'] },
    },
  });

  const columnSizeVars = useColumnSizeVars(table);

  // Track which columns have been user-resized (changes infrequently)
  const resizedColumnIds = useMemo(() => JSON.stringify(Object.keys(columnSizing)), [columnSizing]);

  const hasResizedColumns = Object.keys(columnSizing).length > 0;

  const columnVisibilityKey = useMemo(
    () => JSON.stringify({ columnVisibility, customCols: columnDefs.length }),
    [columnVisibility, columnDefs.length],
  );

  const parentRef = React.useRef<HTMLDivElement>(null);

  const placeHolderText = () => {
    const keyparts = resourceKey.split('::');
    const resource = plural(keyparts[keyparts.length - 1]);

    const count = resources.data?.result?.length;

    return `Search ${count ? `${count} ` : ''}${resource}...`;
  };

  if (resources.isError) {
    return (
      <ResourceTableErrorState
        error={resources.error}
        resourceKey={resourceKey}
      />
    );
  }

  return (
    <TableDrawerContext.Provider value={drawer}>
      <Box sx={tableOuterSx}>
        <TableWrapper sx={tableWrapperRelativeSx}>
          {showSyncingIndicator && (
            <LinearProgress
              variant="indeterminate"
              sx={syncIndicatorSx}
            />
          )}
          {/* Compact toolbar — outside scroll container so it never scrolls horizontally */}
          <ResourceTableToolbar
            connectionID={connectionID}
            resourceKey={resourceKey}
            search={search}
            setSearch={setSearch}
            placeholderText={placeHolderText()}
            createEnabled={createEnabled}
            toolbarActions={toolbarActions}
            toolbarFilters={toolbarFilters}
            hasNamespaceColumn={hasNamespaceColumn}
            hideNamespaceSelector={hideNamespaceSelector}
            sharedNamespaces={sharedNamespaces}
            setSharedNamespaces={setSharedNamespaces}
            data={resources.data?.result || defaultData}
            extraFilterValues={extraFilterValues}
            setExtraFilterValues={setExtraFilterValues}
            hasResizedColumns={hasResizedColumns}
            setColumnSizing={setColumnSizing}
            labels={labels}
            handleLabels={handleLabels}
            annotations={annotations}
            handleAnnotations={handleAnnotations}
            filterAnchor={filterAnchor}
            handleFilterClick={handleFilterClick}
            handleFilterClose={handleFilterClose}
            allFlatColumns={table.getAllFlatColumns()}
          />
          <ScrollContainer
            className={'table-container'}
            ref={parentRef}
            style={{ opacity: showSyncingIndicator ? 0.85 : 1, transition: 'opacity 0.2s ease' }}
          >
            <StyledTable aria-labelledby={'table-title'} style={{ ...columnSizeVars }}>
              <ResourceTableHeader
                table={table}
                columnSizeVars={columnSizeVars}
                columnSizing={columnSizing}
              />
              {resources.isLoading ? (
                <tbody style={{ display: 'grid' }}>
                  {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => `skel-${i}`).map((rowKey) => (
                    <tr key={rowKey} style={{ display: 'flex', width: '100%', height: 30 }}>
                      {table.getVisibleLeafColumns().map((col) => {
                        const flexMeta = (col.columnDef.meta as { flex?: number | undefined })
                          ?.flex;
                        const isUserResized = col.id in (columnSizing ?? {});
                        const applyFlex = flexMeta && !isUserResized;
                        return (
                          <td
                            key={col.id}
                            style={{
                              width: `calc(var(--col-${col.id}-size) * 1px)`,
                              padding: '0px 8px',
                              borderBottom: '1px solid var(--ov-border-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              ...(applyFlex && {
                                minWidth: `calc(var(--col-${col.id}-size) * 1px)`,
                                flex: flexMeta,
                              }),
                            }}
                          >
                            <Skeleton variant="text" width="70%" sx={skeletonSx} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              ) : (
                <ResourceTableBody
                  table={table}
                  tableContainerRef={parentRef}
                  connectionID={connectionID}
                  resourceKey={resourceKey}
                  columnVisibility={columnVisibilityKey}
                  resizedColumnIds={resizedColumnIds}
                  rowSelection={rowSelection}
                  drawer={drawer}
                  memoizer={memoizer}
                />
              )}
            </StyledTable>
          </ScrollContainer>
        </TableWrapper>
      </Box>
    </TableDrawerContext.Provider>
  );
};

ResourceTableContainer.displayName = 'ResourceTableContainer';
ResourceTableContainer.whyDidYouRender = true;

export default ResourceTableContainer;
