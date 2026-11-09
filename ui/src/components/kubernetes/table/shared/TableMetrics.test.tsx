import type { HostRecord } from '@omniviewdev/runtime';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

// The runtime owns observation lifecycle; these tests cover Kubernetes presentation.
const observation = vi.hoisted(() => ({
  metrics: new Map<string, Map<string, object>>(),
  isLoading: false,
  error: null as unknown,
  register: (_body: object) => () => {},
  tokenFor: (_body: object) => 'host-row',
}));
vi.mock('@omniviewdev/runtime', () => ({
  useTableMetricObservation: () => observation,
  parseAppError: (error: Error) => ({ detail: error.message }),
}));

import { TableMetricsProvider, TableMetricsScope, TableMetricCell } from './TableMetrics';

const pod = Object.freeze({ metadata: Object.freeze({ name: 'pod', namespace: 'default' }) });
const recordsByBody = new WeakMap<object, HostRecord>();
afterEach(() => { cleanup(); observation.metrics.clear(); observation.isLoading = false; observation.error = null; });

function App({ known }: { known: boolean }) {
  return <TableMetricsScope value={{ ownerConnectionID: 'test', resourceKey: 'k8s:/pods', ready: true, columns: [{ id: 'cpuUsage', metricID: 'cpu' }] }}>
    <TableMetricsProvider columnVisibility={{ cpuUsage: true }} recordsByBody={recordsByBody}>
      <TableMetricCell body={pod} metricID="cpu" bound={known ? { kind: 'limit', value: 2 } : undefined} />
    </TableMetricsProvider>
  </TableMetricsScope>;
}

it('renders measured zero against a real limit and keeps unknown usage absolute', () => {
  observation.metrics.set('host-row', new Map([['cpu', { id: 'sample', metricID: 'cpu', resourceToken: 'host-row', status: 'ok', value: 0,
    unit: { kind: 'cpu', base: 'cores' }, observedAt: null }]]));
  const app = render(<App known />);
  expect(screen.getByRole('img')).toHaveAccessibleName(/cpu: 0.*limit:/);
  app.rerender(<App known={false} />);
  expect(screen.getByRole('img')).toHaveAccessibleName(/bound unknown; absolute usage/);
  expect(screen.queryByRole('progressbar')).toBeNull();
});

it('shows a static gap and the failure detail when a provider is unavailable', () => {
  observation.error = new Error('Metrics endpoint unavailable');
  render(<App known={false} />);
  expect(screen.getByText('—')).toBeVisible();
  expect(screen.getByTitle('Metrics endpoint unavailable')).toHaveTextContent('—');
  expect(screen.queryByRole('progressbar')).toBeNull();
});
