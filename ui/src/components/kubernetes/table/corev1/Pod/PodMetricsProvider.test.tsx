import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ metricsMap: new Map(), error: null as unknown, isLoading: false }));
vi.mock('@/hooks/usePodMetricsBatch', () => ({ usePodMetricsBatch: () => state }));
import PodMetricsProvider from './PodMetricsProvider';
import MetricUsageCell, { PodMetricsContext } from './cells/MetricUsageCell';
afterEach(() => { cleanup(); state.metricsMap = new Map(); state.error = null; state.isLoading = false; });
function App({ enabled }: { enabled: boolean }) {
  const [selected, setSelected] = useState(false);
  return <PodMetricsProvider connectionID="cluster" records={[]} columnVisibility={{ cpuUsage: enabled, memUsage: false }}>
    <input aria-label="Select pod" type="checkbox" checked={selected} onChange={(event) => setSelected(event.target.checked)} />
    <MetricUsageCell podKey="default/pod" format="cpu" />
  </PodMetricsProvider>;
}
it('keeps selection and focus while metric visibility changes', () => {
  const app = render(<App enabled />);
  const selection = screen.getByRole('checkbox');
  fireEvent.click(selection);
  selection.focus();
  app.rerender(<App enabled={false} />);
  app.rerender(<App enabled />);
  expect(screen.getByRole('checkbox')).toBe(selection);
  expect(selection).toBeChecked();
  expect(selection).toHaveFocus();
});
it('shows unavailable, denied, stale, and error without inventing zero', () => {
  const cell = () => <PodMetricsContext.Provider value={{ ...state }}>
    <MetricUsageCell podKey="default/pod" format="cpu" />
  </PodMetricsContext.Provider>;
  const app = render(cell());
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  state.metricsMap = new Map([['default/pod', { cpu: { status: 'denied', provenance: { native: true } } }]]);
  app.rerender(cell());
  expect(screen.getByText('Denied')).toBeInTheDocument();
  state.metricsMap = new Map([['default/pod', { cpu: { status: 'ambiguous', provenance: { native: true },
    warnings: ['Container series are not a pod total'] } }]]);
  app.rerender(cell());
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  expect(screen.getByTitle('ambiguous · Native · Container series are not a pod total')).toBeInTheDocument();
  state.metricsMap = new Map([['default/pod', { cpu: { status: 'stale', provenance: { native: true }, value: { current_value: { value: 0 } } } }]]);
  app.rerender(cell());
  expect(screen.getByText('0.0m')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Metric: stale' })).toBeInTheDocument();
  expect(screen.getByTitle('stale · Native')).toBeInTheDocument();
  state.error = new Error('network');
  app.rerender(cell());
  expect(screen.getByText('Error')).toBeInTheDocument();
});
it('marks expired partial values without masking expired missing or failed results', () => {
  const cell = () => <PodMetricsContext.Provider value={{ ...state }}>
    <MetricUsageCell podKey="default/pod" format="cpu" />
  </PodMetricsContext.Provider>;
  const setMetric = (status: string, expires = '2000-01-01T00:00:00Z') => {
    state.metricsMap = new Map([['default/pod', { cpu: {
      status, expires_at: expires, provenance: { native: true },
      value: { current_value: { value: 42 } },
    } }]]);
  };
  setMetric('ok', '2099-01-01T00:00:00Z');
  const app = render(cell());
  expect(screen.getByText('42m')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
  setMetric('ok');
  app.rerender(cell());
  expect(screen.getByText('42m')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Metric: stale' })).toBeInTheDocument();
  setMetric('partial');
  app.rerender(cell());
  expect(screen.getByText('42m')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Metric: stale · partial' })).toBeInTheDocument();
  setMetric('failed');
  app.rerender(cell());
  expect(screen.getByText('Error')).toBeInTheDocument();
  expect(screen.queryByText('42m')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  setMetric('missing');
  app.rerender(cell());
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});
