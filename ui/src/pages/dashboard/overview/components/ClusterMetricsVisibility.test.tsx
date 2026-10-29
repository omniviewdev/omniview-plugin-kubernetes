import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ query: vi.fn() }));
// Controlled acquisition boundary; the real dashboard components and QueryClient
// exercise observer lifetime, retained presentation, and identity changes.
vi.mock('@omniviewdev/runtime', () => {
  const providers = [{}];
  return { useResourceMetrics: (options: {
    connectionID: string; resourceNamespace?: string; metricIDs: string[]; shape: number;
    refreshInterval: number; enabled?: boolean; timeRange?: { start: Date; end: Date };
  }) => {
    const query = useQuery({
      queryKey: ['controlled-dashboard', options.connectionID, options.resourceNamespace, options.metricIDs, options.shape, options.timeRange?.start.getTime(), options.timeRange?.end.getTime()],
      queryFn: () => transport.query(options),
      enabled: options.enabled !== false,
      refetchInterval: options.refreshInterval,
      staleTime: 5_000,
      retry: 1,
    });
    return { data: query.data, providers, isLoading: query.isLoading };
  } };
});

import ClusterMetricsSection from './ClusterMetricsSection';
import ClusterResourceGauges from './ClusterResourceGauges';

let client: QueryClient;
let visibility: DocumentVisibilityState;
const timeRange = { from: new Date('2026-10-29T10:00:00Z'), to: new Date('2026-10-29T11:00:00Z') };
const onTimeRangeChange = vi.fn();

function Dashboard({ connectionID = 'a', namespace = '' }: { connectionID?: string; namespace?: string }) {
  return <QueryClientProvider client={client}>
    <div role="region" aria-label="Dashboard scroll">
      <ClusterResourceGauges connectionID={connectionID} />
      <ClusterMetricsSection connectionID={connectionID} namespace={namespace} timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
    </div>
  </QueryClientProvider>;
}
async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
}
async function setVisibility(value: DocumentVisibilityState) {
  visibility = value;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); });
  await settle();
}
beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  transport.query.mockReset();
  transport.query.mockImplementation(async (options: { metricIDs: string[]; shape: number; connectionID: string }) => ({
    fixture: { success: true, results: options.metricIDs.map((metric_id) => options.shape === 1
      ? { time_series: { metric_id, data_points: [{ timestamp: timeRange.from.toISOString(), value: 10 }] } }
      : { current_value: { metric_id, value: options.connectionID === 'a' ? 42 : 73 } }) },
  }));
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('keeps actual gauge and chart elements mounted while hidden and resumes stale polling once', async () => {
  render(<Dashboard />);
  await settle();
  const chart = screen.getByText('CPU Usage');
  const gauge = screen.getByText('CPU');
  const scroller = screen.getByRole('region', { name: 'Dashboard scroll' });
  scroller.scrollTop = 400;
  const initial = transport.query.mock.calls.length;
  expect(initial).toBe(3);
  await setVisibility('hidden');
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
  expect(transport.query).toHaveBeenCalledTimes(initial);
  expect(screen.getByText('CPU Usage')).toBe(chart);
  expect(screen.getByText('CPU')).toBe(gauge);
  expect(scroller.scrollTop).toBe(400);
  await setVisibility('visible');
  expect(transport.query).toHaveBeenCalledTimes(initial + 3);
  expect(screen.getByText('CPU Usage')).toBe(chart);
  expect(screen.getByText('CPU')).toBe(gauge);
});

it('does not acquire on first hidden mount or display old connection/namespace snapshots', async () => {
  visibility = 'hidden';
  const app = render(<Dashboard />);
  await settle();
  expect(transport.query).not.toHaveBeenCalled();
  await setVisibility('visible');
  expect(screen.getAllByText('42.0%').length).toBeGreaterThan(0);
  await setVisibility('hidden');
  app.rerender(<Dashboard connectionID="b" namespace="other" />);
  expect(screen.queryByText('42.0%')).not.toBeInTheDocument();
  expect(screen.queryByText('CPU Usage')).not.toBeInTheDocument();
  expect(screen.getByText('Workload CPU')).toBeInTheDocument();
  expect(transport.query).toHaveBeenCalledTimes(3);
  await setVisibility('visible');
  expect(screen.getAllByText('73.0%').length).toBeGreaterThan(0);
});

it('does not execute queued metric retries while hidden', async () => {
  transport.query.mockRejectedValueOnce(new Error('Temporary metrics failure'));
  render(<Dashboard />);
  await settle();
  expect(transport.query).toHaveBeenCalledTimes(3);
  await setVisibility('hidden');
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(transport.query).toHaveBeenCalledTimes(3);
  await setVisibility('visible');
  expect(transport.query.mock.calls.length).toBeGreaterThan(3);
  expect(screen.getByText('CPU')).toBeInTheDocument();
});
