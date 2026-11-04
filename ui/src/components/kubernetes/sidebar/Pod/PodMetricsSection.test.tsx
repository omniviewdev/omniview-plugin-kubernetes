import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import PodMetricsSection from './PodMetricsSection';

const mocks = vi.hoisted(() => ({ query: vi.fn(), bindings: vi.fn(), definitions: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: { GetMetricBindings: mocks.bindings, GetMetricDefinitions: mocks.definitions } }));
vi.mock('@omniviewdev/runtime', () => ({ useMetricProvidersForResource: () => ({ data: [{ plugin_id: 'kubernetes', handlers: [{ resource: 'k8s:/nodes', metrics: ['cpu_usage', 'cpu_capacity', 'memory_usage', 'memory_capacity'].map(id => ({ id, name: id, unit: id.startsWith('cpu') ? 11 : 1, supported_shapes: [0] })) }] }], error: null, isLoading: false }) }));
vi.mock('@/hooks/usePodMetricsBatch', () => ({ usePodResourceSetMetrics: mocks.query }));
vi.mock('../../../shared/charts', () => ({ MetricsPanel: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('keeps native node metrics under connection-default supplement with pod-only external definitions', async () => {
  mocks.bindings.mockResolvedValue([{ id: 'external', signal: 'metrics', policy: 'supplement', source: { plugin_id: 'grafana', connection_id: 'team', datasource_uid: 'a' } }]);
  mocks.definitions.mockResolvedValue([{ id: 'cpu_usage', name: 'Pod CPU', native: false, resource_keys: ['k8s:/pods'], unit: 12 }]);
  mocks.query.mockImplementation(options => ({ data: { results: Object.entries({ cpu_usage: 42, cpu_capacity: 1000, memory_usage: 1024, memory_capacity: 2048 }).map(([metric_id, value]) => ({ resource_token: options.resources[0]?.token, metric_id, status: 'ok', provenance: { native: true }, value: { current_value: { value } } })) }, error: null, isLoading: false }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PodMetricsSection connectionID="cluster" resourceKey="k8s:/nodes" resourceID="node" reference={{ address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/nodes', id: 'node', scope: [] }, incarnation: 'uid' }} route={{ connection: 'cluster' }} nativeMetricIDs={['cpu_usage', 'cpu_capacity', 'memory_usage', 'memory_capacity']} /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText('42 millicores')).toBeTruthy());
  expect(screen.getByText('1000 millicores')).toBeTruthy();
  expect(screen.getByText('2048 B')).toBeTruthy();
  expect(screen.queryByText('Pod CPU')).toBeNull();
  client.clear();
});

it.each(['replace', 'supplement'])('keeps timeseries-only selections out of current requests under %s', async policy => {
  mocks.bindings.mockResolvedValue([{ id: 'external', signal: 'metrics', policy, source: { plugin_id: 'grafana', connection_id: 'team', datasource_uid: 'a' } }]);
  mocks.definitions.mockResolvedValue([
    ...['cpu_usage', 'memory_usage'].map(id => ({ id, name: id, native: false, resource_keys: ['k8s:/nodes'], supported_shapes: [0] })),
    { id: 'requests', name: 'Request history', native: false, resource_keys: ['k8s:/nodes'], supported_shapes: [1] },
  ]);
  mocks.query.mockReturnValue({ data: { results: [] }, error: null, isLoading: false });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PodMetricsSection connectionID="cluster" resourceKey="k8s:/nodes" resourceID="node" reference={{ address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/nodes', id: 'node', scope: [] }, incarnation: 'uid' }} route={{ connection: 'cluster' }} /></QueryClientProvider>);
  fireEvent.click(await screen.findByLabelText('Request history'));
  await waitFor(() => {
    const calls = mocks.query.mock.calls.map(([options]) => options);
    const current = calls.filter(options => options.shape === undefined).at(-1);
    const history = calls.filter(options => options.shape === 1).at(-1);
    expect(current.metricIDs).toEqual(['cpu_usage', 'memory_usage']);
    expect(current.enabled).toBe(true);
    expect(history.metricIDs).toEqual(['requests']);
    expect(history.enabled).toBe(true);
  });
  client.clear();
});

it.each(['replace', 'supplement'])('admits overlapping native and external shapes independently under %s', async policy => {
  mocks.bindings.mockResolvedValue([{ id: 'external', signal: 'metrics', policy, source: { plugin_id: 'grafana', connection_id: 'team', datasource_uid: 'a' } }]);
  mocks.definitions.mockResolvedValue([
    { id: 'cpu_usage', name: 'CPU history', native: false, resource_keys: ['k8s:/nodes'], supported_shapes: [1] },
    { id: 'memory_usage', name: 'Memory', native: false, resource_keys: ['k8s:/nodes'], supported_shapes: [0] },
  ]);
  mocks.query.mockReturnValue({ data: { results: [] }, error: null, isLoading: false });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PodMetricsSection connectionID="cluster" resourceKey="k8s:/nodes" resourceID="node" reference={{ address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/nodes', id: 'node', scope: [] }, incarnation: 'uid' }} route={{ connection: 'cluster' }} /></QueryClientProvider>);
  fireEvent.click(await screen.findByLabelText('CPU history'));
  const calls = mocks.query.mock.calls.map(([options]) => options);
  expect(calls.filter(options => options.shape === undefined).at(-1).metricIDs).toEqual(
    policy === 'replace' ? ['memory_usage'] : ['memory_usage', 'cpu_usage'],
  );
  expect(calls.filter(options => options.shape === 1).at(-1).metricIDs).toEqual(['cpu_usage']);
  client.clear();
});

it('keeps explicit native sidebar acquisition enabled after external catalog failure', async () => {
  mocks.bindings.mockResolvedValue([{ id: 'external', signal: 'metrics', policy: 'replace', source: { plugin_id: 'grafana', connection_id: 'team', datasource_uid: 'a' } }]);
  mocks.definitions.mockRejectedValue(new Error('External catalog failed'));
  mocks.query.mockReturnValue({ data: { results: [] }, error: null, isLoading: false });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PodMetricsSection connectionID="cluster" resourceKey="k8s:/nodes" resourceID="node" reference={{ address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/nodes', id: 'node', scope: [] }, incarnation: 'uid' }} route={{ connection: 'cluster' }} /></QueryClientProvider>);
  await screen.findByText('External catalog failed');
  fireEvent.change(screen.getByLabelText('Metric source'), { target: { value: 'native' } });
  const current = mocks.query.mock.calls.map(([options]) => options).filter(options => options.shape === undefined).at(-1);
  expect(current).toMatchObject({ bindingID: 'native', metricIDs: ['cpu_usage', 'memory_usage'], enabled: true });
  expect(screen.queryByRole('alert')).toBeNull();
  client.clear();
});
