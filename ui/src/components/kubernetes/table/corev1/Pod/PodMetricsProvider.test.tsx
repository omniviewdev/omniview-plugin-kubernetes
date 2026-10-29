import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ query: vi.fn(async () => ({
  fixture: { success: true, results: [
    { current_value: { metric_id: 'cpu_usage', value: 12, labels: { namespace: 'default', pod: 'pod' } } },
  ] },
})) }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: { QueryAll: transport.query } }));

import PodMetricsProvider from './PodMetricsProvider';
import MetricUsageCell from './cells/MetricUsageCell';

let client: QueryClient;
afterEach(() => { cleanup(); client?.clear(); transport.query.mockClear(); vi.restoreAllMocks(); vi.useRealTimers(); });

function StatefulTable() {
  const [selected, setSelected] = useState(false);
  return <div role="region" aria-label="Pod rows" style={{ height: 50, overflow: 'auto' }}>
    <input aria-label="Filter pods" />
    <table><tbody><tr aria-selected={selected}>
      <td><input type="checkbox" aria-label="Select pod" checked={selected} onChange={(event) => setSelected(event.target.checked)} /></td>
      <td><MetricUsageCell podKey="default/pod" format="cpu" /></td>
    </tr></tbody></table>
  </div>;
}

it('retains scroll, focus, and row selection while metric columns and document visibility toggle', async () => {
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  let visibility: DocumentVisibilityState = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  function App({ enabled }: { enabled: boolean }) {
    return <QueryClientProvider client={client}><MemoryRouter initialEntries={['/cluster/test']}>
      <Routes><Route path="/cluster/:id" element={
        <PodMetricsProvider columnVisibility={{ cpuUsage: enabled, memUsage: false }}>
          <StatefulTable />
        </PodMetricsProvider>
      } /></Routes>
    </MemoryRouter></QueryClientProvider>;
  }
  const app = render(<App enabled={false} />);
  expect(transport.query).not.toHaveBeenCalled();
  const scroller = screen.getByRole('region', { name: 'Pod rows' });
  const filter = screen.getByRole('textbox', { name: 'Filter pods' });
  const selection = screen.getByRole('checkbox', { name: 'Select pod' });
  fireEvent.click(selection);
  filter.focus();
  scroller.scrollTop = 240;

  app.rerender(<App enabled />);
  await waitFor(() => expect(screen.getByText('12m')).toBeInTheDocument());
  expect(transport.query).toHaveBeenCalledTimes(1);
  app.rerender(<App enabled={false} />);
  await act(async () => {
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  app.rerender(<App enabled />);
  await act(async () => {
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });

  expect(screen.getByRole('region', { name: 'Pod rows' })).toBe(scroller);
  expect(scroller.scrollTop).toBe(240);
  expect(screen.getByRole('textbox', { name: 'Filter pods' })).toBe(filter);
  expect(filter).toHaveFocus();
  expect(screen.getByRole('checkbox', { name: 'Select pod' })).toBe(selection);
  expect(selection).toBeChecked();
  expect(screen.getByRole('row')).toHaveAttribute('aria-selected', 'true');
  expect(transport.query).toHaveBeenCalledTimes(1);
});

it.each(['columns', 'document'] as const)('does not start a queued retry while %s are hidden', async (reason) => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  let visibility: DocumentVisibilityState = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  transport.query.mockRejectedValueOnce(new Error('Temporary metrics failure'));
  function App({ enabled }: { enabled: boolean }) {
    return <QueryClientProvider client={client}><MemoryRouter initialEntries={['/cluster/test']}>
      <Routes><Route path="/cluster/:id" element={
        <PodMetricsProvider columnVisibility={{ cpuUsage: enabled, memUsage: false }}>
          <StatefulTable />
        </PodMetricsProvider>
      } /></Routes>
    </MemoryRouter></QueryClientProvider>;
  }
  const app = render(<App enabled />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(transport.query).toHaveBeenCalledTimes(1);
  if (reason === 'columns') {
    app.rerender(<App enabled={false} />);
  } else {
    await act(async () => {
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(transport.query).toHaveBeenCalledTimes(1);
  await act(async () => {
    visibility = 'visible';
    // Reach Query's window listener, as native visibilitychange does, to resume paused retries.
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  app.rerender(<App enabled />);
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(transport.query).toHaveBeenCalledTimes(2);
  expect(screen.getByText('12m')).toBeInTheDocument();
});
