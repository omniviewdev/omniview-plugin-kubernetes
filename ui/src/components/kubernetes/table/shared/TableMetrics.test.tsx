import type { HostRecord } from '@omniviewdev/runtime';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

// The runtime owns observation lifecycle; these tests cover Kubernetes presentation.
// Each registered token/metric pair has its own pending state even when the aggregate is loading.
const observation = vi.hoisted(() => ({
  metrics: new Map<string, Map<string, object>>(),
  pending: new Set<string>(),
  error: null as unknown,
}));
vi.mock('@omniviewdev/runtime', () => ({
  useTableMetricObservation: ({ recordsByBody }: { recordsByBody: WeakMap<object, { key: string }> }) => ({
    register: () => () => {},
    tokenFor: (body: object) => recordsByBody.get(body)?.key,
    metrics: observation.metrics,
    isLoadingFor: (body: object, metricID: string) => observation.pending.has(`${recordsByBody.get(body)?.key}/${metricID}`),
    error: observation.error,
    isLoading: observation.pending.size > 0,
  }),
  parseAppError: (error: Error) => ({ detail: error.message }),
}));

import { TableMetricsProvider, TableMetricsScope, TableMetricCell } from './TableMetrics';

const pod = Object.freeze({ metadata: Object.freeze({ name: 'pod', namespace: 'default' }) });
const record: HostRecord = {
  key: 'host-row', addressKey: 'host-address', targetId: 'host-target', route: { connection: 'cluster' },
  record: {
    reference: {
      address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/pods', scope: [{ dimension: 'namespace', value: 'default' }], id: 'pod' },
      incarnation: 'pod-uid',
    },
    body: { kind: 'map', value: {} },
    representation: { id: 'native-json', revision: 'format-1' },
    coverage: { kind: 'complete', paths: [] },
  },
};
const recordsByBody = new WeakMap<object, HostRecord>([[pod, record]]);
const cpuSample = { id: 'cpu-sample', metricID: 'cpu', resourceToken: record.key, status: 'ok', value: 0, unit: { kind: 'cpu', base: 'cores' }, observedAt: null };
const unavailableMemory = { id: 'memory-sample', metricID: 'memory', resourceToken: record.key, status: 'unavailable', value: null, unit: null, observedAt: null };
// Only a placeholder carries aria-busy; samples and gaps never do.
const busy = () => document.querySelector('[aria-busy="true"]');
afterEach(() => { cleanup(); observation.metrics.clear(); observation.pending.clear(); observation.error = null; });

function App({ known }: { known: boolean }) {
  return <TableMetricsScope value={{ ownerConnectionID: 'test', resourceKey: 'k8s:/pods', ready: true, columns: [{ id: 'cpuUsage', metricID: 'cpu' }] }}>
    <TableMetricsProvider columnVisibility={{ cpuUsage: true }} recordsByBody={recordsByBody}>
      <TableMetricCell body={pod} metricID="cpu" bound={known ? { kind: 'limit', value: 2 } : undefined} />
    </TableMetricsProvider>
  </TableMetricsScope>;
}

/** One row with two selected metric columns: each cell settles on its own. */
function Row() {
  return <TableMetricsScope value={{ ownerConnectionID: 'test', resourceKey: 'k8s:/pods', ready: true, columns: [{ id: 'cpuUsage', metricID: 'cpu' }, { id: 'memUsage', metricID: 'memory' }] }}>
    <TableMetricsProvider columnVisibility={{ cpuUsage: true, memUsage: true }} recordsByBody={recordsByBody}>
      <div data-testid="cpu"><TableMetricCell body={pod} metricID="cpu" /></div>
      <div data-testid="memory"><TableMetricCell body={pod} metricID="memory" /></div>
    </TableMetricsProvider>
  </TableMetricsScope>;
}

it('renders measured zero against a real limit and keeps unknown usage absolute', () => {
  observation.metrics.set(record.key, new Map([['cpu', cpuSample]]));
  const app = render(<App known />);
  expect(screen.getByRole('img')).toHaveAccessibleName(/cpu: 0.*limit:/);
  app.rerender(<App known={false} />);
  expect(screen.getByRole('img')).toHaveAccessibleName(/bound unknown; absolute usage/);
  expect(busy()).toBeNull();
  // A refresh in flight must not blank the sample it refreshes.
  observation.pending.add(`${record.key}/cpu`);
  app.rerender(<App known />);
  expect(screen.getByRole('img')).toHaveAccessibleName(/cpu: 0.*limit:/);
  expect(busy()).toBeNull();
});

it('shows a static gap and the failure detail when a provider is unavailable', () => {
  observation.error = new Error('Metrics endpoint unavailable');
  render(<App known={false} />);
  expect(screen.getByText('—')).toBeVisible();
  expect(screen.getByTitle('Metrics endpoint unavailable')).toHaveTextContent('—');
  expect(busy()).toBeNull();
});

it('holds a placeholder for the pending cell only, then settles it to a static gap', () => {
  // Memory already settled as unavailable (no unit to draw) while CPU still waits for its first sample.
  observation.metrics.set(record.key, new Map([['memory', unavailableMemory]]));
  observation.pending.add(`${record.key}/cpu`);
  const app = render(<Row />);
  expect(screen.getByRole('group', { name: 'cpu: Loading' })).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByRole('group', { name: 'memory: Loading' })).toBeNull();
  expect(screen.getByTitle('unavailable')).toHaveTextContent('—');
  // CPU settles without a sample: a gap, not a placeholder that never ends.
  observation.pending.clear();
  app.rerender(<Row />);
  expect(busy()).toBeNull();
  expect(screen.getByTestId('cpu')).toHaveTextContent('—');
  expect(screen.getByTestId('memory')).toHaveTextContent('—');
});

it('lets a failure replace a pending placeholder, even while the runtime still lists the cell as pending', () => {
  observation.pending.add(`${record.key}/cpu`);
  observation.error = new Error('Metrics endpoint unavailable');
  render(<App known={false} />);
  expect(screen.getByTitle('Metrics endpoint unavailable')).toHaveTextContent('—');
  expect(busy()).toBeNull();
});
