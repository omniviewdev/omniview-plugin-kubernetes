import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import { styled } from '@mui/material/styles';
import TableSortLabel from '@mui/material/TableSortLabel';
import Tooltip from '@mui/material/Tooltip';
import { useResources, DrawerComponent } from '@omniviewdev/runtime';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Alert, Skeleton } from '@omniviewdev/ui/feedback';
import { Stack } from '@omniviewdev/ui/layout';
import { Text, Heading } from '@omniviewdev/ui/typography';
import {
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnSizingState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table';
import get from 'lodash.get';
import React, { useMemo, useState } from 'react';
import { LuCircleAlert, LuColumns3 } from 'react-icons/lu';

import type { KubernetesResourceObject } from '../../../types/resource';
import { plural } from '../../../utils/language';
import { CreateResourceButton } from '../../kubernetes/actions/create';
import ColumnFilter from '../../tables/ColumnFilter';
import { useDynamicResourceColumns } from '../../tables/ColumnFilter/useDynamicResourceColumns';
import { DebouncedInput } from '../../tables/DebouncedInput';
import NamespaceSelect from '../../tables/NamespaceSelect';
import { useConnectionNamespaces } from '../hooks/useConnectionNamespaces';
import { useStoredState } from '../hooks/useStoredState';

// ---------------------------------------------------------------------------
// Static styles
// ---------------------------------------------------------------------------

const errorHeadingSx = { color: 'danger.main' } as const;

const errorWrapperSx = {
  display: 'flex',
  gap: 2,
  justifyContent: 'center',
  flexDirection: 'column',
  alignItems: 'center',
  height: '100%',
  width: '100%',
  userSelect: 'none',
} as const;

const errorStackSx = { maxWidth: 560, textAlign: 'center' } as const;
const errorDetailSx = { color: 'text.secondary' } as const;
const errorListSx = { textAlign: 'left', pl: 2, m: 0 } as const;
const errorListItemSx = { py: 0.25 } as const;
const errorListItemTextSx = { color: 'text.secondary' } as const;
const errorCodeSx = {
  color: 'text.disabled',
  fontFamily: 'monospace',
  mt: 1,
  p: 1,
  borderRadius: 1,
  bgcolor: 'action.hover',
  wordBreak: 'break-all',
  maxHeight: 80,
  overflow: 'auto',
} as const;

const tableOuterSx = { display: 'flex', flex: 1, flexDirection: 'column', p: 0.75, gap: 0, minHeight: 0 } as const;
const tableWrapperRelativeSx = { position: 'relative' } as const;

const syncIndicatorSx = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 2,
  zIndex: 3,
  bgcolor: 'transparent',
  '& .MuiLinearProgress-bar': {
    bgcolor: 'var(--ov-accent-fg, #58a6ff)',
  },
} as const;

const toolbarSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  px: 1,
  py: 0.5,
  borderBottom: '1px solid var(--ov-border-default)',
  bgcolor: 'var(--ov-bg-surface)',
  flexShrink: 0,
} as const;

const toolbarSpacerSx = { flex: 1 } as const;
const resetColumnsButtonSx = { width: 28, height: 28 } as const;

const sortLabelSx = {
  fontSize: 'inherit',
  fontWeight: 'inherit',
  color: 'inherit !important',
  '& .MuiTableSortLabel-icon': { fontSize: 12, opacity: 0.5 },
} as const;

const skeletonSx = { fontSize: '0.75rem' } as const;

import ResourceTableBody from './ResourceTableBody';
import { TableDrawerContext } from './TableDrawerContext';
import { ColumnMeta } from './types';
import { useColumnSizeVars } from './useColumnSizeVars';
import { getCommonPinningStyles } from './utils';


export type Memoizer = string | string[] | ((data: KubernetesResourceObject) => string);

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

const TableWrapper = styled('div')`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--ov-border-default);
  border-radius: 4px;
  background-color: var(--ov-bg-base);
  overflow: hidden;
`;

const ScrollContainer = styled('div')`
  flex: 1;
  overflow: scroll;
  overscroll-behavior: none;
  min-height: 0;
  &::-webkit-scrollbar {
    display: none;
  }
  scrollbar-width: none;
  -webkit-user-select: none;
`;

const StyledTable = styled('table')`
  display: grid;
  width: 100%;
  border-collapse: collapse;
  -webkit-user-select: none;

  .resize-handle {
    position: absolute;
    right: 0;
    top: 0;
    height: 100%;
    width: 4px;
    cursor: col-resize;
    touch-action: none;
    user-select: none;
    opacity: 0;
    background: var(--ov-border-default);
    transition: opacity 0.15s ease;
  }

  th:hover .resize-handle,
  .resize-handle.isResizing {
    opacity: 1;
  }

  .resize-handle.isResizing {
    background: var(--ov-accent-fg, #58a6ff);
    opacity: 1;
  }
`;

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
  const showSyncingIndicator = isSyncing && (resources.data?.result?.length ?? 0) > 0;
  const { labels, setLabels, annotations, setAnnotations, columnDefs } = useDynamicResourceColumns({
    connectionID,
    resourceKey,
  });

  const handleLabels = (vals: Record<string, boolean>) => {
    setLabels((prev) => ({ ...prev, ...vals }));
  };

  const handleAnnotations = (vals: Record<string, boolean>) => {
    setAnnotations((prev) => ({ ...prev, ...vals }));
  };

  const allColumns = [...columns, ...columnDefs];

  // Auto-detect whether this resource has a namespace column
  const hasNamespaceColumn = allColumns.some((col) => col.id === 'namespace');

  // Merge shared namespace selection into column filters for TanStack
  const effectiveColumnFilters = useMemo<ColumnFiltersState>(() => {
    if (!hasNamespaceColumn || sharedNamespaces.length === 0) {
      // Strip any stale namespace entries from per-resource filters
      return columnFilters.filter((f) => f.id !== 'namespace');
    }
    // Replace/inject namespace filter with shared selection
    const withoutNs = columnFilters.filter((f) => f.id !== 'namespace');
    return [...withoutNs, { id: 'namespace', value: sharedNamespaces }];
  }, [columnFilters, sharedNamespaces, hasNamespaceColumn]);

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

    const count = resources.data?.result.length;

    return `Search ${count ? `${count} ` : ''}${resource}...`;
  };

  if (resources.isError) {
    const errstring = resources.error?.toString() ?? '';
    console.error('Failed loading resources', errstring);

    let title = 'Failed to load resources';
    let detail = errstring;
    let suggestions: string[] = [];

    if (errstring.includes('could not find the requested resource')) {
      title = 'Resource group not found';
      detail = 'The requested resource type could not be found on this cluster.';
      suggestions = [
        'The resource group may not exist on this cluster',
        'The API group may have been removed or is not installed',
        'You may not have permission to discover this API group',
      ];
    } else if (
      errstring.includes('forbidden') ||
      errstring.includes('Forbidden') ||
      errstring.includes('403')
    ) {
      title = 'Access denied';
      detail = 'You do not have permission to access this resource.';
      suggestions = [
        'Check your RBAC permissions for this resource type',
        'Contact your cluster administrator for access',
        'Verify your kubeconfig context is correct',
      ];
    } else if (
      errstring.includes('connection refused') ||
      errstring.includes('no such host') ||
      errstring.includes('network') ||
      errstring.includes('timeout') ||
      errstring.includes('ETIMEDOUT') ||
      errstring.includes('ECONNREFUSED')
    ) {
      title = 'Connection error';
      detail = 'Unable to reach the cluster API server.';
      suggestions = [
        'Check that the cluster is running and reachable',
        'Verify your network connection',
        'Check if a VPN or proxy is required',
      ];
    } else if (
      errstring.includes('certificate') ||
      errstring.includes('x509') ||
      errstring.includes('TLS')
    ) {
      title = 'Certificate error';
      detail = 'There was a TLS/certificate issue connecting to the cluster.';
      suggestions = [
        'The cluster certificate may have expired',
        'Your kubeconfig may reference outdated certificates',
        'Check if the CA bundle is configured correctly',
      ];
    } else if (
      errstring.includes('unauthorized') ||
      errstring.includes('Unauthorized') ||
      errstring.includes('401')
    ) {
      title = 'Authentication failed';
      detail = 'Your credentials were rejected by the cluster.';
      suggestions = [
        'Your auth token may have expired — try re-authenticating',
        'Check your kubeconfig credentials',
        'If using OIDC, try refreshing your login',
      ];
    }

    return (
      <Box sx={errorWrapperSx}>
        <Alert
          emphasis="soft"
          size="lg"
          startAdornment={<LuCircleAlert size={20} />}
          color="danger"
        >
          <Heading level="h4" sx={errorHeadingSx}>
            {title}
          </Heading>
        </Alert>
        <Stack direction="column" spacing={1} sx={errorStackSx}>
          <Text size="sm" sx={errorDetailSx}>
            {detail}
          </Text>
          {suggestions.length > 0 && (
            <Box component="ul" sx={errorListSx}>
              {suggestions.map((s) => (
                <Box component="li" key={s} sx={errorListItemSx}>
                  <Text size="xs" sx={errorListItemTextSx}>
                    {s}
                  </Text>
                </Box>
              ))}
            </Box>
          )}
          <Text
            size="xs"
            sx={errorCodeSx}
          >
            {resourceKey}: {errstring || 'Unknown error'}
          </Text>
        </Stack>
      </Box>
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
          <Box sx={toolbarSx}>
            <DebouncedInput
              value={search ?? ''}
              onChange={(value) => {
                setSearch(String(value));
              }}
              placeholder={placeHolderText()}
            />
            <Box sx={toolbarSpacerSx} />
            <Stack direction="row" gap={1} alignItems="center">
              {createEnabled && (
                <CreateResourceButton connectionID={connectionID} resourceKey={resourceKey} />
              )}
              {toolbarActions}
              {hasNamespaceColumn && !hideNamespaceSelector && (
                <NamespaceSelect
                  connectionID={connectionID}
                  selected={sharedNamespaces}
                  setNamespaces={setSharedNamespaces}
                />
              )}
              {hasResizedColumns && (
                <Tooltip title="Reset column widths" placement="bottom">
                  <IconButton
                    emphasis="outline"
                    color="neutral"
                    onClick={() => setColumnSizing({})}
                    sx={resetColumnsButtonSx}
                  >
                    <LuColumns3 size={14} />
                  </IconButton>
                </Tooltip>
              )}
              <ColumnFilter
                labels={labels}
                setLabels={handleLabels}
                annotations={annotations}
                setAnnotations={handleAnnotations}
                anchorEl={filterAnchor}
                onClose={handleFilterClose}
                columns={table.getAllFlatColumns()}
                onClick={handleFilterClick}
              />
            </Stack>
          </Box>
          <ScrollContainer
            className={'table-container'}
            ref={parentRef}
            style={{ opacity: showSyncingIndicator ? 0.85 : 1, transition: 'opacity 0.2s ease' }}
          >
            <StyledTable aria-labelledby={'table-title'} style={{ ...columnSizeVars }}>
              <thead
                style={{
                  display: 'grid',
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                }}
              >
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} style={{ display: 'flex', width: '100%' }}>
                    {headerGroup.headers.map((header) => {
                      const flexMeta = (
                        header.column.columnDef.meta as { flex?: number | undefined }
                      )?.flex;
                      const isUserResized = header.column.id in (columnSizing ?? {});
                      const applyFlex = flexMeta && !isUserResized;
                      return (
                        <th
                          key={header.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            overflow: 'hidden',
                            width: `calc(var(--header-${header.id}-size) * 1px)`,
                            padding: '0px 8px',
                            height: 32,
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            color: 'var(--ov-fg-muted)',
                            backgroundColor: 'var(--ov-bg-surface)',
                            borderBottom: '1px solid var(--ov-border-default)',
                            whiteSpace: 'nowrap',
                            userSelect: 'none',
                            letterSpacing: '0.01em',
                            position: 'relative',
                            ...(applyFlex && {
                              minWidth: `calc(var(--header-${header.id}-size) * 1px)`,
                              flex: flexMeta,
                            }),
                            ...getCommonPinningStyles(header.column, true),
                          }}
                        >
                          {header.isPlaceholder ? null : header.column.getCanSort() ? (
                            <TableSortLabel
                              active={!!header.column.getIsSorted()}
                              direction={header.column.getIsSorted() === 'desc' ? 'desc' : 'asc'}
                              onClick={header.column.getToggleSortingHandler()}
                              sx={sortLabelSx}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                            </TableSortLabel>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                          {header.column.getCanResize() && (
                            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                            <div
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              onDoubleClick={() => header.column.resetSize()}
                              className={`resize-handle ${table.getState().columnSizingInfo.isResizingColumn === header.column.id ? 'isResizing' : ''}`}
                            />
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              {resources.isLoading ? (
                <tbody style={{ display: 'grid' }}>
                  {Array.from({ length: 8 }, (_, i) => `skel-${i}`).map((rowKey) => (
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
