import type { HostRecord } from '@omniviewdev/runtime';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  observe: vi.fn(),
  catalog: vi.fn(),
  source: { mode: 'inherit', source: undefined as undefined | { plugin_id: string; connection_id: string; datasource_uid: string; datasource_kind: string } },
  loading: false,
  results: [] as object[],
}));
vi.mock('@omniviewdev/runtime', () => ({
  useMetricObservation: (input: unknown) => { state.observe(input); return { results: state.results, error: null }; },
  useMetricViewSourceSelection: () => ({ selection: state.source, isLoading: state.loading, error: null }),
  useMetricCatalog: (input: unknown) => {
    state.catalog(input);
    return { data: { metrics: [
      { id: 'cpu', name: 'CPU', shapes: ['current'] },
      { id: 'custom.requests', name: 'Custom requests', shapes: ['current'] },
      { id: 'history.only', name: 'History', shapes: ['range'] },
    ] }, isLoading: false, error: null };
  },
}));

import { TableMetricsProvider, TableMetricsScope, TableMetricCell, useTableMetrics } from './TableMetrics';

const pod = Object.freeze({ metadata: Object.freeze({ name: 'pod', namespace: 'default' }) });
const record: HostRecord = {
  key: 'host-row', addressKey: 'host-address', targetId: 'host-target', route: { connection: 'cluster' },
  record: {
    reference: {
      address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/pods', scope: [{ dimension: 'namespace', value: 'default' }], id: 'pod' },
      incarnation: 'pod-uid',
    },
    body: { kind: 'map', value: {} },
    representation: { id: 'native-json', revision: 'schema', schema: { state: 'absent', validation: 'dynamic', unvalidated: [] } },
    coverage: { kind: 'complete', paths: [] },
  },
};
const recordsByBody = new WeakMap([[pod, record]]);
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); state.observe.mockClear(); state.catalog.mockClear();
  state.source = { mode: 'inherit', source: undefined }; state.loading = false;
  state.results = [];
});

function StatefulTable() {
  const [selected, setSelected] = useState(false);
  return <div role="region" aria-label="Pod rows" style={{ height: 50, overflow: 'auto' }}>
    <input aria-label="Filter pods" />
    <table><tbody><tr aria-selected={selected}>
      <td><input type="checkbox" aria-label="Select pod" checked={selected} onChange={(event) => setSelected(event.target.checked)} /></td>
      <td><TableMetricCell body={pod} metricID="cpu" /></td>
    </tr></tbody></table>
  </div>;
}

it('retains immutable rows, scroll, focus, and selection while metrics pause', async () => {
  let visibility: DocumentVisibilityState = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  function App({ enabled }: { enabled: boolean }) {
    return <MemoryRouter initialEntries={['/cluster/test']}>
      <Routes><Route path="/cluster/:id" element={
        <TableMetricsScope value={{ ownerConnectionID: 'test', resourceKey: 'k8s:/pods', ready: true, columns: [{ id: 'cpuUsage', metricID: 'cpu' }] }}>
          <TableMetricsProvider columnVisibility={{ cpuUsage: enabled, memUsage: false }} recordsByBody={recordsByBody}>
            <StatefulTable />
          </TableMetricsProvider>
        </TableMetricsScope>
      } /></Routes>
    </MemoryRouter>;
  }
  const app = render(<App enabled={false} />);
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({ enabled: false });
  const scroller = screen.getByRole('region', { name: 'Pod rows' });
  const filter = screen.getByRole('textbox', { name: 'Filter pods' });
  const selection = screen.getByRole('checkbox', { name: 'Select pod' });
  fireEvent.click(selection);
  filter.focus();
  scroller.scrollTop = 240;
  app.rerender(<App enabled />);
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({ enabled: true });
  app.rerender(<App enabled={false} />);
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({ enabled: false });
  await act(async () => {
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  app.rerender(<App enabled />);
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({ enabled: false });
  await act(async () => {
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({ enabled: true });
  expect(screen.getByRole('region', { name: 'Pod rows' })).toBe(scroller);
  expect(scroller.scrollTop).toBe(240);
  expect(screen.getByRole('textbox', { name: 'Filter pods' })).toBe(filter);
  expect(filter).toHaveFocus();
  expect(screen.getByRole('checkbox', { name: 'Select pod' })).toBe(selection);
  expect(selection).toBeChecked();
  expect(screen.getByRole('row')).toHaveAttribute('aria-selected', 'true');
  expect(Object.keys(pod)).toEqual(['metadata']);
});

const defaults = { cpu: 'cpuUsage' };
function CatalogTable({ selected = false, resourceKey = 'k8s:/pods' }: { selected?: boolean; resourceKey?: string }) {
  const metrics = useTableMetrics<typeof pod>({ ownerConnectionID: 'test', resourceKey }, defaults);
  return <TableMetricsScope value={metrics.scope}>
    <output>{metrics.columns.map(column => `${column.id}:${column.meta && 'defaultHidden' in column.meta ? column.meta.defaultHidden : undefined}`).join(',')}</output>
    <TableMetricsProvider columnVisibility={{ cpuUsage: true, 'metric:custom.requests': selected }} recordsByBody={recordsByBody}>
      <TableMetricCell body={pod} metricID="cpu" />
      {selected && <TableMetricCell body={pod} metricID="custom.requests" />}
    </TableMetricsProvider>
  </TableMetricsScope>;
}

it('discovers optional custom current columns and shares one deduplicated target batch', () => {
  const app = render(<CatalogTable />);
  expect(screen.getByRole('status')).toHaveTextContent('cpuUsage:false,metric:custom.requests:true');
  expect(screen.getByRole('status')).not.toHaveTextContent('history.only');
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({ metricIDs: ['cpu'], enabled: true });
  app.rerender(<CatalogTable selected />);
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({
    metricIDs: ['cpu', 'custom.requests'],
    targets: [{ token: record.key, reference: record.record.reference, route: record.route }],
    shape: 'current', enabled: true,
  });
  app.rerender(<CatalogTable />);
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({ metricIDs: ['cpu'], targets: [{ token: record.key }] });
});

it('routes Node catalog and shared observations through the same explicit source', () => {
  state.source = { mode: 'external', source: {
    plugin_id: 'grafana', connection_id: 'monitoring', datasource_uid: 'prometheus-uid', datasource_kind: 'prometheus',
  } };
  render(<CatalogTable selected resourceKey="k8s:/nodes" />);
  expect(state.catalog.mock.lastCall?.[0]).toMatchObject({ resourceKey: 'k8s:/nodes', source: state.source.source });
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({ resourceKey: 'k8s:/nodes', source: state.source.source, enabled: true });
});

it('waits for durable source readiness without unmounting table rows', () => {
  state.loading = true;
  const app = render(<CatalogTable selected />);
  const value = screen.getByRole('status');
  expect(state.catalog.mock.lastCall?.[0]).toMatchObject({ enabled: false });
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({ enabled: false });
  state.loading = false;
  app.rerender(<CatalogTable selected />);
  expect(screen.getByRole('status')).toBe(value);
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({ enabled: true });
});

it('does not fall back to native when an explicit external choice lacks its source', () => {
  state.source = { mode: 'external', source: undefined };
  render(<CatalogTable selected />);
  expect(state.catalog.mock.lastCall?.[0]).toMatchObject({ enabled: false });
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({ enabled: false });
});

it('selects the explicit native source for catalog and observation together', () => {
  state.source = { mode: 'native', source: undefined };
  render(<CatalogTable selected resourceKey="k8s:/nodes" />);
  const source = { plugin_id: 'kubernetes', connection_id: 'test', native: true, datasource_uid: '', datasource_kind: '' };
  expect(state.catalog.mock.lastCall?.[0]).toMatchObject({ source, enabled: true });
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({ source, enabled: true });
});

it('renders a real bounded cell and keeps unknown usage absolute', () => {
  state.results = [{ id: 'sample', metricID: 'cpu', resourceToken: record.key, status: 'ok', value: 0,
    unit: { kind: 'cpu', base: 'cores' }, observedAt: null }];
  function App({ known }: { known: boolean }) {
    return <TableMetricsScope value={{ ownerConnectionID: 'test', resourceKey: 'k8s:/pods', ready: true, columns: [{ id: 'cpuUsage', metricID: 'cpu' }] }}>
      <TableMetricsProvider columnVisibility={{ cpuUsage: true }} recordsByBody={recordsByBody}>
        <TableMetricCell body={pod} metricID="cpu" bound={known ? { kind: 'limit', value: 2 } : undefined} />
      </TableMetricsProvider>
    </TableMetricsScope>;
  }
  const app = render(<App known />);
  expect(screen.getByRole('img')).toHaveAccessibleName(/cpu: 0.*limit:/);
  app.rerender(<App known={false} />);
  expect(screen.getByRole('img')).toHaveAccessibleName(/bound unknown; absolute usage/);
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({ targets: [{ token: record.key }], metricIDs: ['cpu'] });
});


