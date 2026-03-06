import { ArrowDropDown } from '@mui/icons-material';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Skeleton from '@mui/material/Skeleton';
import { useResources, WatchState } from '@omniviewdev/runtime';
import { Alert } from '@omniviewdev/ui/feedback';
import { Stack } from '@omniviewdev/ui/layout';
import { Text, Heading } from '@omniviewdev/ui/typography';
import {
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import get from 'lodash.get';
import React, { useState } from 'react';
import { LuCircleAlert } from 'react-icons/lu';

import MemoizedRow from './MemoizedRow';

const skeletonContainerSx = {
  backgroundColor: 'inherit',
  width: '100%',
  borderRadius: '4px',
  flex: 1,
  minHeight: 0,
  border: '1px solid',
  borderColor: 'divider',
  overflow: 'hidden',
} as const;

const skeletonTextSx = { fontSize: '0.75rem' } as const;

const syncingOverlaySx = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  width: '100%',
  gap: 2,
} as const;

const syncingSpinnerSx = { color: 'var(--ov-accent-fg, #58a6ff)' } as const;

const syncingProgressSx = {
  width: 200,
  height: 3,
  borderRadius: 1.5,
  bgcolor: 'rgba(255,255,255,0.08)',
  '& .MuiLinearProgress-bar': {
    bgcolor: 'var(--ov-accent-fg, #58a6ff)',
    borderRadius: 1.5,
  },
} as const;

const errorContainerSx = {
  display: 'flex',
  gap: 2,
  justifyContent: 'center',
  flexDirection: 'column',
  alignItems: 'center',
  height: '100%',
  width: '100%',
  userSelect: 'none',
} as const;

const errorDetailStackSx = { maxWidth: 560, textAlign: 'center' } as const;

const errorSuggestionListSx = { textAlign: 'left', pl: 2, m: 0 } as const;

const errorSuggestionItemSx = { py: 0.25 } as const;

const errorDetailTextSx = {
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

const tableStyle = {
  display: 'grid',
  width: '100%',
  borderCollapse: 'collapse',
  WebkitUserSelect: 'none',
} as const;

const theadStyle = {
  display: 'grid',
  position: 'sticky',
  top: 0,
  zIndex: 1,
} as const;

const syncingIndicatorSx = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 2,
  zIndex: 2,
  bgcolor: 'transparent',
  '& .MuiLinearProgress-bar': {
    bgcolor: 'var(--ov-accent-fg, #58a6ff)',
  },
} as const;

const skeletonTableStyle = { display: 'grid', width: '100%', borderCollapse: 'collapse' } as const;

const skeletonTheadStyle = { display: 'grid', position: 'sticky', top: 0, zIndex: 1 } as const;

const skeletonTbodyStyle = { display: 'grid' } as const;

const syncingTextSx = { color: 'var(--ov-fg-muted)' } as const;

const errorHeadingSx = { color: 'danger.main' } as const;

const textSecondarySx = { color: 'text.secondary' } as const;

export type Memoizer = string | string[] | ((data: Record<string, unknown>) => string);
export type IdAccessor = string | ((data: Record<string, unknown>) => string);

export type Props = {
  columns: Array<ColumnDef<Record<string, unknown>>>;
  namespaces?: string[];
  initialColumnVisibility?: VisibilityState;
  idAccessor: IdAccessor;
  namespaceAccessor?: string;
  memoizer?: Memoizer;
  pluginID: string;
  connectionID: string;
  resourceKey: string;
  search?: string;
};

const idAccessorResolver = (data: Record<string, unknown>, accessor: IdAccessor): string => {
  switch (typeof accessor) {
    case 'function':
      return accessor(data);
    case 'string':
      return get(data, accessor) as string;
    default:
      throw new Error('Invalid ID accessor');
  }
};

// eslint-disable-next-line react-refresh/only-export-components
export const namespaceFilter: FilterFn<Record<string, unknown>> = (row, columnId, value: string[]) => {
  if (!value?.length) {
    return true;
  }

  return value.includes(row.getValue(columnId));
};

const ResourceTableContainer: React.FC<Props> = ({
  columns,
  idAccessor,
  namespaceAccessor,
  memoizer,
  pluginID,
  connectionID,
  resourceKey,
  initialColumnVisibility,
  search,
}) => {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([
    { id: 'namespace', value: [] },
  ]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  React.useLayoutEffect(() => {
    const storedColumnVisibility = window.localStorage.getItem(
      `${pluginID}-${connectionID}-${resourceKey}-column-visibility`,
    );
    if (storedColumnVisibility && initialColumnVisibility) {
      const current = JSON.parse(storedColumnVisibility) as VisibilityState;

      Object.entries(initialColumnVisibility).forEach(([key, value]) => {
        if (!Object.hasOwn(current, key)) {
          current[key] = value;
        }
      });

      setColumnVisibility(current);
    } else if (initialColumnVisibility) {
      setColumnVisibility(initialColumnVisibility);
    }
  }, [initialColumnVisibility, connectionID, pluginID, resourceKey]);

  React.useEffect(() => {
    const visibility = JSON.stringify(columnVisibility);
    if (visibility !== '{}') {
      window.localStorage.setItem(
        `${pluginID}-${connectionID}-${resourceKey}-column-visibility`,
        visibility,
      );
    }
  }, [columnVisibility, connectionID, pluginID, resourceKey]);

  const { resources, watchState, isSyncing } = useResources({
    pluginID,
    connectionID,
    resourceKey,
  });

  const table = useReactTable({
    data: resources.data?.result || [],
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => idAccessorResolver(row as Record<string, unknown>, idAccessor),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter: search,
    },
    defaultColumn: {
      minSize: 0,
      size: Number.MAX_SAFE_INTEGER,
      maxSize: Number.MAX_SAFE_INTEGER,
    },
  });

  const { rows } = table.getRowModel();

  const parentRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: React.useCallback(() => 36, []),
    overscan: 10,
  });

  // Derive loading states from watch
  const isInitialLoad = !resources.data && !resources.isError;
  const showSkeleton = isInitialLoad || watchState === WatchState.IDLE;
  const showSyncingOverlay = isSyncing && (resources.data?.result?.length ?? 0) === 0;
  const showSyncingIndicator = isSyncing && (resources.data?.result?.length ?? 0) > 0;

  // Skeleton / syncing overlay states
  if (showSkeleton) {
    return (
      <Box
        sx={skeletonContainerSx}
      >
        <table style={skeletonTableStyle}>
          <thead style={skeletonTheadStyle}>
            <tr style={{ display: 'flex', width: '100%' }}>
              {columns.slice(0, 5).map((col) => (
                <th key={col.id ?? col.header?.toString()} style={{ flex: 1, padding: '8px 12px' }}>
                  <Skeleton variant="text" width="60%" sx={skeletonTextSx} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={skeletonTbodyStyle}>
            {Array.from({ length: 8 }, (_, i) => `skeleton-row-${i}`).map((rowKey, i) => (
              <tr
                key={rowKey}
                style={{ display: 'flex', width: '100%', height: 36, opacity: 1 - i * 0.08 }}
              >
                {columns.slice(0, 5).map((col) => (
                  <td
                    key={col.id ?? col.header?.toString()}
                    style={{ flex: 1, padding: '6px 12px', display: 'flex', alignItems: 'center' }}
                  >
                    <Skeleton
                      variant="text"
                      width={`${50 + Math.random() * 40}%`}
                      sx={skeletonTextSx}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    );
  }

  if (showSyncingOverlay) {
    return (
      <Box
        sx={syncingOverlaySx}
      >
        <CircularProgress size={32} thickness={4} sx={syncingSpinnerSx} />
        <Text size="sm" sx={syncingTextSx}>
          Syncing {resourceKey.split('::').pop()}...
        </Text>
        <LinearProgress
          variant="indeterminate"
          sx={syncingProgressSx}
        />
      </Box>
    );
  }

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
      <Box
        sx={errorContainerSx}
      >
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
        <Stack direction="column" spacing={1} sx={errorDetailStackSx}>
          <Text size="sm" sx={textSecondarySx}>
            {detail}
          </Text>
          {suggestions.length > 0 && (
            <Box component="ul" sx={errorSuggestionListSx}>
              {suggestions.map((s) => (
                <Box component="li" key={s} sx={errorSuggestionItemSx}>
                  <Text size="xs" sx={textSecondarySx}>
                    {s}
                  </Text>
                </Box>
              ))}
            </Box>
          )}
          <Text
            size="xs"
            sx={errorDetailTextSx}
          >
            {resourceKey}: {errstring || 'Unknown error'}
          </Text>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      className={'table-container'}
      ref={parentRef}
      sx={{
        backgroundColor: 'inherit',
        width: '100%',
        borderRadius: '4px',
        flex: 1,
        overflow: 'scroll',
        minHeight: 0,
        border: '1px solid',
        borderColor: 'divider',
        position: 'relative',
        '&::-webkit-scrollbar': {
          display: 'none',
        },
        scrollbarWidth: 'none',
        WebkitUserSelect: 'none',
        opacity: showSyncingIndicator ? 0.85 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      {showSyncingIndicator && (
        <LinearProgress
          variant="indeterminate"
          sx={syncingIndicatorSx}
        />
      )}
      <table
        aria-labelledby={'table-title'}
        style={tableStyle}
      >
        <thead
          style={theadStyle}
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} style={{ display: 'flex', width: '100%', cursor: 'pointer' }}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  style={{
                    alignContent: 'center',
                    display: 'flex',
                    alignItems: 'center',
                    width: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                    minWidth:
                      header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                    maxWidth:
                      header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                    flex: 1,
                  }}
                >
                  {header.column.getCanSort() ? (
                    <Box
                      component="button"
                      onClick={header.column.getToggleSortingHandler()}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'primary.main',
                        fontWeight: 'bold',
                        p: 0,
                        '& svg': {
                          transition: '0.2s',
                          transform:
                            (header.column.getIsSorted() as string) === 'desc'
                              ? 'rotate(180deg)'
                              : 'rotate(0deg)',
                        },
                      }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() && <ArrowDropDown />}
                    </Box>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody
          style={{
            display: 'grid',
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <MemoizedRow
                key={row.id}
                pluginID={pluginID}
                connectionID={connectionID}
                resourceID={row.id}
                resourceKey={resourceKey}
                namespace={namespaceAccessor ? (get(row.original, namespaceAccessor) as string | undefined) : undefined}
                row={row}
                memoizer={memoizer}
                virtualizer={virtualizer}
                virtualRow={virtualRow}
                isSelected={!!rowSelection[row.id]}
                columnVisibility={JSON.stringify(columnVisibility)}
              />
            );
          })}
        </tbody>
      </table>
    </Box>
  );
};

ResourceTableContainer.displayName = 'ResourceTableContainer';
ResourceTableContainer.whyDidYouRender = true;

export default ResourceTableContainer;
