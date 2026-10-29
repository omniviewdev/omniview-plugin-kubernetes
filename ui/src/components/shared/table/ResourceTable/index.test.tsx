import React, { type PropsWithChildren } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { DataTableFeatures } from '@omniviewdev/base-ui';
import type { ColumnDef } from '@tanstack/react-table';

const transport = vi.hoisted(() => ({ query: vi.fn(async () => ({})) }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: { QueryAll: transport.query } }));
vi.mock('@omniviewdev/runtime', () => ({
  useResources: () => ({ resources: { isLoading: true }, isSyncing: false }),
  useRightDrawer: () => ({ openDrawer: vi.fn() }),
  usePluginRouter: () => ({ location: { key: 'test', pathname: '/pods', search: '' } }),
}));
vi.mock('@/hooks/useConnectionNamespaces', () => ({ useConnectionNamespaces: () => ({ namespaces: [], setNamespaces: vi.fn() }) }));
vi.mock('../../../tables/ColumnFilter/useDynamicResourceColumns', () => ({ useDynamicResourceColumns: () => ({
  labels: {}, annotations: {}, columnDefs: [], setLabels: vi.fn(), setAnnotations: vi.fn(),
}) }));
vi.mock('./ResourceTableToolbar', () => ({ default: ({ allFlatColumns }: { allFlatColumns: Array<{ id: string; toggleVisibility: (visible: boolean) => void }> }) => (
  <button onClick={() => allFlatColumns.find((column) => column.id === 'cpuUsage')?.toggleVisibility(true)}>Show CPU</button>
) }));
vi.mock('../../drawer/DrawerActionsBridge', () => ({ default: () => null }));

import ResourceTable from './index';
import { usePodMetricsBatch } from '@/hooks/usePodMetricsBatch';

const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
const columns: Array<ColumnDef<DataTableFeatures, { name: string }>> = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
  { id: 'cpuUsage', accessorKey: 'name', header: 'CPU' },
  { id: 'memUsage', accessorKey: 'name', header: 'Memory' },
];
function MetricsConsumer({ columnVisibility, children }: PropsWithChildren<{ columnVisibility: Record<string, boolean> }>) {
  usePodMetricsBatch({ connectionID: 'test', enabled: columnVisibility.cpuUsage !== false || columnVisibility.memUsage !== false });
  return <>{children}</>;
}

afterEach(() => { client.clear(); localStorage.clear(); transport.query.mockClear(); });

it('reads persisted hidden metric columns before mounting the query consumer', async () => {
  localStorage.setItem('kubernetes-test-core::v1::Pod-column-visibility', JSON.stringify({ cpuUsage: false, memUsage: false }));
  render(<QueryClientProvider client={client}>
    <ResourceTable columns={columns} connectionID="test" resourceKey="core::v1::Pod" idAccessor="name" contentWrapper={MetricsConsumer} />
  </QueryClientProvider>);
  expect(transport.query).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Show CPU' }));
  await waitFor(() => expect(transport.query).toHaveBeenCalledTimes(1));
  expect(JSON.parse(localStorage.getItem('kubernetes-test-core::v1::Pod-column-visibility')!)).toMatchObject({ cpuUsage: true, memUsage: false });
});
