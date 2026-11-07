import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as BaseUI from '@omniviewdev/base-ui';
import type { ColumnDef } from '@tanstack/react-table';
import ResourceTable from './index';

const mocks = vi.hoisted(() => {
  const first = { key: 'host-first', record: { body: { name: 'First row' } } };
  const second = { key: 'host-second', record: { body: { name: 'Second row' } } };
  return {
    resources: vi.fn(),
    loading: false,
    sourceError: false,
    firstData: { records: [first, second] },
    targetId: 'host-target',
  };
});
vi.mock('@omniviewdev/base-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof BaseUI>();
  return {
    ...actual,
    Button: ({ children, disabled, onClick }: React.PropsWithChildren<{ disabled?: boolean; onClick?: () => void }>) => <button disabled={disabled} onClick={onClick}>{children}</button>,
    Stack: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
    Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
    Progress: () => null,
    Skeleton: () => null,
    DataTable: {
      Root: ({ children, table }: React.PropsWithChildren<{ table: React.ComponentProps<typeof BaseUI.DataTable.Root>['table'] }>) => <actual.DataTable.Root table={table}>{table.getRowModel().rows.map((row) => <button key={row.id} aria-pressed={row.getIsSelected()} onClick={() => row.toggleSelected()}>{row.id}</button>)}{children}</actual.DataTable.Root>,
      Container: ({ children }: React.PropsWithChildren) => <table>{children}</table>,
      Header: actual.DataTable.Header,
      VirtualBody: () => <tbody />,
    },
  };
});
vi.mock('@omniviewdev/runtime', () => ({
  useResourceType: () => ({ resourceType: { data: { displayName: 'Charts', capabilities: [] } } }),
  useResolvedResourceTarget: () => ({ data: { targetId: mocks.targetId, target: { type: 'helm:charts' } } }),
  useResources: mocks.resources,
  usePluginRouter: () => ({ location: { search: '', key: 'location', pathname: '/' } }),
  useRightDrawer: () => ({ openDrawer: vi.fn() }),
}));
vi.mock('../../../tables/ColumnFilter/useDynamicResourceColumns', () => ({ useDynamicResourceColumns: () => ({ labels: {}, annotations: {}, columnDefs: [], setLabels: vi.fn(), setAnnotations: vi.fn() }) }));
vi.mock('@/hooks/useConnectionNamespaces', () => ({ useConnectionNamespaces: () => ({ namespaces: [], setNamespaces: vi.fn() }) }));
vi.mock('../../drawer/DrawerActionsBridge', () => ({ default: () => null }));
vi.mock('./ResourceTableToolbar', () => ({ default: ({ allFlatColumns }: { allFlatColumns: Array<{ id: string; toggleVisibility: (visible: boolean) => void }> }) => (
  <button onClick={() => allFlatColumns.find((column) => column.id === 'cpuUsage')?.toggleVisibility(true)}>Show CPU</button>
) }));
vi.mock('./ResourceTableErrorState', () => ({ default: () => <div>Collection failed</div> }));
vi.mock('./rows', () => ({ decodeResourceTableRows: (records: Array<{ key: string; record: { body: { name: string } } }>) => ({
  rows: records.map(({ record }) => record.body),
  recordsByBody: new WeakMap(records.map((record) => [record.record.body, record])),
  rowKeys: records.map(({ key }) => key),
}) }));

const columns: Array<ColumnDef<BaseUI.DataTableFeatures, { name: string }>> = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
  { id: 'cpuUsage', accessorKey: 'name', header: 'CPU' },
  { id: 'memUsage', accessorKey: 'name', header: 'Memory' },
];

beforeEach(() => {
  mocks.loading = false;
  mocks.sourceError = false;
  mocks.targetId = 'host-target';
  mocks.resources.mockReset();
  mocks.resources.mockImplementation(({ request }) => {
    const data = mocks.loading ? undefined : mocks.firstData;
    return { sourceError: mocks.sourceError, acquired: data ? { request, page: data } : undefined, resources: {
      data,
      isLoading: mocks.loading, isFetching: mocks.loading, isSuccess: !mocks.loading, refetch: vi.fn(),
    } };
  });
});
afterEach(() => { localStorage.clear(); });

describe('resource collection selections', () => {
  it('shows retained resources when source updates fail', () => {
    mocks.sourceError = true;
    render(<ResourceTable connectionID="connection" resourceKey="helm:charts" columns={columns} />);
    expect(screen.getByText('Live updates unavailable. Showing the last acquired resources.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'host-first' })).toBeTruthy();
  });

  it('selects host keys across the collection without source-page controls', () => {
    render(<ResourceTable connectionID="connection" resourceKey="helm:charts" columns={columns} />);
    fireEvent.click(screen.getByRole('button', { name: 'host-first' }));
    fireEvent.click(screen.getByRole('button', { name: 'host-second' }));
    expect(screen.getByRole('button', { name: 'host-first' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'host-second' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull();
    expect(mocks.resources).toHaveBeenLastCalledWith(expect.objectContaining({
      pluginID: 'kubernetes',
      request: expect.objectContaining({ targetId: 'host-target' }),
      live: false, collection: true,
    }));
  });

  it('resets collection selection when resolved target context changes', () => {
    const view = render(<ResourceTable connectionID="connection" resourceKey="helm:charts" columns={columns} />);
    fireEvent.click(screen.getByRole('button', { name: 'host-first' }));
    view.rerender(<ResourceTable connectionID="connection" resourceKey="helm:charts" columns={columns} />);
    expect(screen.getByRole('button', { name: 'host-first' }).getAttribute('aria-pressed')).toBe('true');
    mocks.targetId = 'other-target';
    view.rerender(<ResourceTable connectionID="other-connection" resourceKey="helm:charts" columns={columns} />);
    expect(screen.getByRole('button', { name: 'host-first' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'host-second' }).getAttribute('aria-pressed')).toBe('false');
  });
});

it('restores hidden columns and persists visibility changes', () => {
  localStorage.setItem('kubernetes-test-k8s:/pods-column-visibility', JSON.stringify({ cpuUsage: false, memUsage: false }));
  render(<ResourceTable columns={columns} connectionID="test" resourceKey="k8s:/pods" />);
  expect(screen.queryByRole('columnheader', { name: 'CPU' })).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'Memory' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show CPU' }));
  expect(screen.getByRole('columnheader', { name: 'CPU' })).toBeTruthy();
  expect(screen.queryByRole('columnheader', { name: 'Memory' })).toBeNull();
  expect(JSON.parse(localStorage.getItem('kubernetes-test-k8s:/pods-column-visibility')!)).toMatchObject({ cpuUsage: true, memUsage: false });
});

it('keeps required visible fields shown without revealing locked hidden fields', () => {
  localStorage.setItem('kubernetes-connection-helm:charts-column-visibility', JSON.stringify({
    name: false, cpuUsage: false, memUsage: true,
  }));
  const policyColumns = [
    { id: 'name', accessorKey: 'name', header: 'Name', enableHiding: false },
    { id: 'cpuUsage', accessorKey: 'name', header: 'CPU', enableHiding: false, meta: { defaultHidden: true } },
    { id: 'memUsage', accessorKey: 'name', header: 'Memory', meta: { defaultHidden: true } },
  ];
  render(<ResourceTable connectionID="connection" resourceKey="helm:charts" columns={policyColumns} />);
  expect(screen.getByRole('columnheader', { name: /Name/ })).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: /Memory/ })).toBeTruthy();
  expect(screen.queryByRole('columnheader', { name: /CPU/ })).toBeNull();
});

it('applies defaults to late catalog columns without resetting row selection or stored choices', () => {
  localStorage.setItem('kubernetes-test-k8s:/pods-column-visibility', JSON.stringify({ cpuUsage: false }));
  const view = render(<ResourceTable columns={columns} connectionID="test" resourceKey="k8s:/pods" />);
  const row = screen.getByRole('button', { name: 'host-first' });
  fireEvent.click(row);
  const catalogColumns = [...columns, {
    id: 'metric:custom.requests', accessorKey: 'name', header: 'Requests', meta: { defaultHidden: true },
  }];
  view.rerender(<ResourceTable columns={catalogColumns} connectionID="test" resourceKey="k8s:/pods" />);
  expect(screen.queryByRole('columnheader', { name: 'Requests' })).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'CPU' })).toBeNull();
  expect(screen.getByRole('button', { name: 'host-first' })).toBe(row);
  expect(row).toHaveAttribute('aria-pressed', 'true');
});
