import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ metricsMap: new Map(), error: null as unknown, isLoading: false }));
vi.mock('@/hooks/usePodMetricsBatch', () => ({ usePodMetricsBatch: () => state }));
import PodMetricsProvider from './PodMetricsProvider';
import MetricUsageCell from './cells/MetricUsageCell';
afterEach(() => { cleanup(); state.metricsMap.clear(); state.error = null; state.isLoading = false; });
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
  const app = render(<App enabled />);
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  state.metricsMap.set('default/pod', { cpu: { status: 'denied', provenance: { native: true } } });
  app.rerender(<App enabled />);
  expect(screen.getByText('Denied')).toBeInTheDocument();
  state.metricsMap.set('default/pod', { cpu: { status: 'stale', provenance: { native: true }, value: { current_value: { value: 0 } } } });
  app.rerender(<App enabled />);
  expect(screen.getByText('0.0m (stale)')).toBeInTheDocument();
  expect(screen.getByTitle('stale · Native')).toBeInTheDocument();
  state.error = new Error('network');
  app.rerender(<App enabled />);
  expect(screen.getByText('Error')).toBeInTheDocument();
});
