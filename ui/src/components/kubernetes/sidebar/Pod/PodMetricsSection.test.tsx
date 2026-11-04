import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import PodMetricsSection from './PodMetricsSection';
import { updateMetricPreferences } from './useMetricPreferences';

const mocks = vi.hoisted(() => ({ query: vi.fn(), bindings: vi.fn(), definitions: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: { GetMetricBindings: mocks.bindings, GetMetricDefinitions: mocks.definitions, GetProviderConnections: vi.fn(async () => [{ id: 'team', name: 'Production EU' }]), GetDataSources: vi.fn(async () => [{ uid: 'a', name: 'Prometheus' }]) } }));
vi.mock('@omniviewdev/runtime', () => ({ useMetricProvidersForResource: () => ({ data: [{ plugin_id: 'kubernetes', handlers: [{ resource: 'k8s:/nodes', metrics: ['cpu_usage', 'cpu_capacity', 'memory_usage', 'memory_capacity'].map(id => ({ id, name: id, unit: id.startsWith('cpu') ? 11 : 1, supported_shapes: [0] })) }] }], error: null, isLoading: false }) }));
vi.mock('@/hooks/usePodMetricsBatch', () => ({ usePodResourceSetMetrics: mocks.query }));
afterEach(() => { cleanup(); window.localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null })); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it('keeps native node metrics under connection-default supplement with pod-only external definitions', async () => {
  mocks.bindings.mockResolvedValue([{ id: 'external', signal: 'metrics', policy: 'supplement', source: { plugin_id: 'grafana', connection_id: 'team', datasource_uid: 'a' } }]);
  mocks.definitions.mockResolvedValue([{ id: 'cpu_usage', name: 'Pod CPU', native: false, resource_keys: ['k8s:/pods'], unit: 12 }]);
  mocks.query.mockImplementation(options => ({ data: { results: Object.entries({ cpu_usage: 42, cpu_capacity: 1000, memory_usage: 1024, memory_capacity: 2048 }).filter(([id]) => options.enabled && options.shape === undefined && options.metricIDs.includes(id)).map(([metric_id, value]) => ({ resource_token: options.resources[0]?.token, metric_id, status: 'ok', provenance: { native: true }, value: { current_value: { value } } })) }, error: null, isLoading: false }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PodMetricsSection connectionID="cluster" resourceKey="k8s:/nodes" resourceID="node" reference={{ address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/nodes', id: 'node', scope: [] }, incarnation: 'uid' }} route={{ connection: 'cluster' }} nativeMetricIDs={['cpu_usage', 'cpu_capacity', 'memory_usage', 'memory_capacity']} /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText(/42/)).toBeTruthy());
  expect(screen.getByRole('button', { name: 'cpu_usage: Line' })).toBeDisabled();
  expect(screen.getByText(/1,000/)).toBeTruthy();
  expect(screen.getAllByText('Ki').some(element => element.parentElement?.textContent === '2 Ki')).toBe(true);
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
  fireEvent.click(screen.getByRole('button', { name: 'Add metric' }));
  fireEvent.click(await screen.findByLabelText('Request history'));
  expect(screen.getByRole('button', { name: 'Request history: Stat' })).toBeDisabled();
  await waitFor(() => {
    const calls = mocks.query.mock.calls.map(([options]) => options);
    const currentLanes = calls.filter(options => options.shape === undefined).slice(-2);
    const [current, additionalCurrent] = currentLanes;
    const history = calls.filter(options => options.shape === 1).at(-1);
    expect(current.metricIDs).toEqual(['cpu_usage', 'memory_usage']);
    expect(current.enabled).toBe(true);
    expect(additionalCurrent.metricIDs).toEqual([]);
    expect(additionalCurrent.enabled).toBe(false);
    expect(history.metricIDs).toEqual(['requests']);
    expect(history.enabled).toBe(true);
  });
  client.clear();
});

it.each(['replace', 'supplement'])('keeps base current and history subscriptions unchanged when adding and removing extras under %s', async policy => {
  mocks.bindings.mockResolvedValue([{ id: 'external', signal: 'metrics', policy, source: { plugin_id: 'grafana', connection_id: 'team', datasource_uid: 'a' } }]);
  mocks.definitions.mockResolvedValue([
    ...['cpu_usage', 'memory_usage'].map(id => ({ id, name: id, native: false, resource_keys: ['k8s:/nodes'], supported_shapes: [0, 1] })),
    { id: 'network_receive', name: 'Network receive', native: false, resource_keys: ['k8s:/nodes'], supported_shapes: [0, 1] },
  ]);
  mocks.query.mockReturnValue({ data: { results: [] }, error: null, isLoading: false });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PodMetricsSection connectionID="cluster" resourceKey="k8s:/nodes" resourceID="node" reference={{ address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/nodes', id: 'node', scope: [] }, incarnation: 'uid' }} route={{ connection: 'cluster' }} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Add metric' }));
  const checkbox = await screen.findByRole('button', { name: 'Network receive' });
  const before = mocks.query.mock.calls.map(([options]) => options);
  const baseBefore = before.filter(options => options.shape === undefined).at(-2);
  expect(baseBefore.metricIDs).toEqual(['cpu_usage', 'memory_usage']);
  expect(before.filter(options => options.shape === 1).at(-1).enabled).toBe(false);
  const baseHistoryBefore = before.filter(options => options.shape === 1).at(-2);
  expect(baseHistoryBefore).toMatchObject({ metricIDs: ['cpu_usage', 'memory_usage'], enabled: true });
  fireEvent.click(checkbox);
  const calls = mocks.query.mock.calls.map(([options]) => options);
  const [base, extra] = calls.filter(options => options.shape === undefined).slice(-2);
  expect(base).toEqual(baseBefore);
  expect(base.enabled).toBe(true);
  expect(extra).toMatchObject({ metricIDs: ['network_receive'], enabled: true });
  expect(extra.resources).toBe(base.resources);
  expect(extra.bindingID).toBe(base.bindingID);
  expect(calls.filter(options => options.shape === 1).at(-1)).toMatchObject({ metricIDs: ['network_receive'], enabled: true });
  const [baseHistory, extraHistory] = calls.filter(options => options.shape === 1).slice(-2);
  expect(baseHistory).toEqual(baseHistoryBefore);
  expect(baseHistory.resources).toBe(baseHistoryBefore.resources);
  expect(extraHistory).toMatchObject({
    metricIDs: ['network_receive'], enabled: true,
    startTime: baseHistory.startTime, endTime: baseHistory.endTime,
    bindingID: baseHistory.bindingID, step: baseHistory.step,
  });
  expect(extraHistory.resources).toBe(baseHistory.resources);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Network receive' }));
  const afterRemoval = mocks.query.mock.calls.map(([options]) => options);
  expect(afterRemoval.filter(options => options.shape === undefined).at(-2)).toEqual(baseBefore);
  expect(afterRemoval.filter(options => options.shape === 1).at(-2)).toEqual(baseHistoryBefore);
  expect(afterRemoval.filter(options => options.shape === 1).at(-1)).toMatchObject({ metricIDs: [], enabled: false });
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
  await screen.findByRole('button', { name: 'Remove CPU history' });
  const calls = mocks.query.mock.calls.map(([options]) => options);
  expect(calls.filter(options => options.shape === undefined).at(-2).metricIDs).toEqual(
    policy === 'replace' ? ['memory_usage'] : ['memory_usage', 'cpu_usage'],
  );
  expect(calls.filter(options => options.shape === 1).at(-2).metricIDs).toEqual(['cpu_usage']);
  client.clear();
});

it('keeps explicit native sidebar acquisition enabled after external catalog failure', async () => {
  const user = userEvent.setup();
  mocks.bindings.mockResolvedValue([{ id: 'external', signal: 'metrics', policy: 'replace', source: { plugin_id: 'grafana', connection_id: 'team', datasource_uid: 'a' } }]);
  mocks.definitions.mockRejectedValue(new Error('External catalog failed'));
  mocks.query.mockReturnValue({ data: { results: [] }, error: null, isLoading: false });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PodMetricsSection connectionID="cluster" resourceKey="k8s:/nodes" resourceID="node" reference={{ address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/nodes', id: 'node', scope: [] }, incarnation: 'uid' }} route={{ connection: 'cluster' }} /></QueryClientProvider>);
  await screen.findByText('External catalog failed');
  await user.click(screen.getByLabelText('Metric source'));
  await user.click(await screen.findByRole('option', { name: 'Native Kubernetes' }));
  await waitFor(() => {
    const current = mocks.query.mock.calls.map(([options]) => options).filter(options => options.shape === undefined).at(-2);
    expect(current).toMatchObject({ bindingID: 'native', metricIDs: ['cpu_usage', 'memory_usage'], enabled: true });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  client.clear();
});

it('requests supported base history by default and removes cards without widening the shared current lane', async () => {
  mocks.bindings.mockResolvedValue([{ id: 'external', signal: 'metrics', policy: 'replace', source: { plugin_id: 'grafana', connection_id: 'team', datasource_uid: 'a' } }]);
  mocks.definitions.mockResolvedValue([
    { id: 'cpu_usage', name: 'CPU usage', native: false, resource_keys: ['k8s:/nodes'], supported_shapes: [0, 1] },
    { id: 'memory_usage', name: 'Memory', native: false, resource_keys: ['k8s:/nodes'], supported_shapes: [0] },
  ]);
  mocks.query.mockReturnValue({ data: { results: [] }, error: null, isLoading: false });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PodMetricsSection connectionID="cluster" resourceKey="k8s:/nodes" resourceID="node" reference={{ address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/nodes', id: 'node', scope: [] }, incarnation: 'uid' }} route={{ connection: 'cluster' }} /></QueryClientProvider>);
  const remove = await screen.findByRole('button', { name: 'Remove CPU usage' });
  expect(mocks.query.mock.calls.map(([options]) => options).filter(options => options.shape === 1).at(-2)).toMatchObject({ metricIDs: ['cpu_usage'], enabled: true });
  const base = mocks.query.mock.calls.map(([options]) => options).filter(options => options.shape === undefined).at(-2);
  fireEvent.click(remove);
  expect(screen.queryByRole('button', { name: 'Remove CPU usage' })).toBeNull();
  const calls = mocks.query.mock.calls.map(([options]) => options);
  expect(calls.filter(options => options.shape === undefined).at(-2)).toEqual(base);
  expect(calls.filter(options => options.shape === 1).at(-2)).toMatchObject({ metricIDs: [], enabled: false });
  client.clear();
});

it('formats values, resolves friendly source names, and combines current/history provenance without hiding stale history', async () => {
  const source = { plugin_id: 'grafana', connection_id: 'team', datasource_uid: 'a' };
  mocks.bindings.mockResolvedValue([{ id: 'external', signal: 'metrics', policy: 'replace', source }]);
  mocks.definitions.mockResolvedValue([{ id: 'memory_usage', name: 'Memory', native: false, resource_keys: ['k8s:/nodes'], supported_shapes: [0, 1], unit: 1 }]);
  mocks.query.mockImplementation(options => ({
    data: { results: options.enabled ? [{
      resource_token: options.resources[0]?.token, metric_id: 'memory_usage',
      status: options.shape === 1 ? 'stale' : 'ok', dimensions: {},
      provenance: { native: false, source },
      value: options.shape === 1 ? { time_series: { data_points: [] } } : { current_value: { value: 16777216 } },
    }] : [] }, error: null, isLoading: false,
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PodMetricsSection connectionID="cluster" resourceKey="k8s:/nodes" resourceID="node" reference={{ address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/nodes', id: 'node', scope: [] }, incarnation: 'uid' }} route={{ connection: 'cluster' }} /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByLabelText('Metric source').textContent).toContain('Production EU / Prometheus'));
  expect(screen.getByText('Mi').parentElement?.textContent).toBe('16 Mi');
  expect(screen.getByRole('button', { name: 'Memory status: stale' })).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Memory source details'));
  expect(screen.getByRole('row', { name: /History/ })).toContainElement(screen.getByRole('img', { name: 'stale' }));
  expect(screen.getByRole('row', { name: /Current/ })).toContainElement(screen.getByRole('img', { name: 'ok' }));
  client.clear();
});

it('shares aligned history windows across views, advances at the boundary, and refreshes only the active window', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T12:00:12.345Z'));
  const historyRefetch = vi.fn();
  const currentRefetch = vi.fn();
  mocks.query.mockImplementation(options => ({ data: { results: [] }, error: null, isLoading: false, refetch: options.shape === 1 ? historyRefetch : currentRefetch }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  const source = { plugin_id: 'grafana', connection_id: 'team', datasource_uid: 'a' };
  client.setQueryData(['metric', 'bindings', 'kubernetes', 'cluster'], [{ id: 'external', signal: 'metrics', policy: 'replace', source }]);
  client.setQueryData(['metric', 'definitions'], [{ id: 'cpu_usage', name: 'CPU usage', native: false, resource_keys: ['k8s:/nodes'], supported_shapes: [0, 1], unit: 11 }]);
  client.setQueryData(['metric', 'provider-connections', 'grafana'], [{ id: 'team', name: 'Production EU' }]);
  client.setQueryData(['metric', 'datasources', 'grafana', 'team'], [{ uid: 'a', name: 'Prometheus' }]);
  const props = { connectionID: 'cluster', resourceKey: 'k8s:/nodes', resourceID: 'node', reference: { address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/nodes', id: 'node', scope: [] }, incarnation: 'uid' }, route: { connection: 'cluster' } };
  const first = render(<QueryClientProvider client={client}><PodMetricsSection {...props} /></QueryClientProvider>);
  const firstHistory = mocks.query.mock.calls.map(([options]) => options).filter(options => options.shape === 1 && options.enabled).at(-1);
  expect(firstHistory).toMatchObject({ startTime: '2026-11-04T11:00:00.000Z', endTime: '2026-11-04T12:00:00.000Z', refreshInterval: 0 });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  const second = render(<QueryClientProvider client={client}><PodMetricsSection {...props} /></QueryClientProvider>);
  const secondHistory = mocks.query.mock.calls.map(([options]) => options).filter(options => options.shape === 1 && options.enabled).at(-1);
  expect(secondHistory).toEqual(firstHistory);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000 - Date.now() % 30_000); });
  const advancedHistory = mocks.query.mock.calls.map(([options]) => options).filter(options => options.shape === 1 && options.enabled).at(-1);
  expect(advancedHistory).toMatchObject({ startTime: '2026-11-04T11:00:30.000Z', endTime: '2026-11-04T12:00:30.000Z', refreshInterval: 0 });
  expect(historyRefetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole('button', { name: 'Refresh metrics' })[0]);
  expect(historyRefetch).toHaveBeenCalledTimes(1);
  expect(currentRefetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date('2026-11-04T12:01:00.000Z'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Refresh metrics' })[0]);
  expect(historyRefetch).toHaveBeenCalledTimes(1);
  expect(mocks.query.mock.calls.map(([options]) => options).filter(options => options.shape === 1 && options.enabled).at(-1)).toMatchObject({ endTime: '2026-11-04T12:01:00.000Z' });
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(mocks.query.mock.calls.map(([options]) => options).filter(options => options.shape === 1).slice(-2).every(options => !options.enabled)).toBe(true);
  first.unmount();
  second.unmount();
  visibility.mockRestore();
  act(() => updateMetricPreferences('k8s:/nodes', previous => ({ ...previous, duration: '900000' })));
  vi.setSystemTime(new Date('2026-11-04T14:00:12.000Z'));
  const reopened = render(<QueryClientProvider client={client}><PodMetricsSection {...props} resourceID="other-node" /></QueryClientProvider>);
  expect(mocks.query.mock.calls.map(([options]) => options).filter(options => options.shape === 1 && options.enabled).at(-1)).toMatchObject({
    startTime: '2026-11-04T13:45:00.000Z', endTime: '2026-11-04T14:00:00.000Z',
  });
  reopened.unmount();
  client.clear();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(vi.getTimerCount()).toBe(0);
});

it('switches actual chart visuals without hiding current and history states', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 180, top: 0, left: 0, right: 400, bottom: 180, x: 0, y: 0, toJSON: () => ({}) });
  const source = { plugin_id: 'grafana', connection_id: 'team', datasource_uid: 'a' };
  mocks.bindings.mockResolvedValue([{ id: 'external', signal: 'metrics', policy: 'replace', source }]);
  mocks.definitions.mockResolvedValue([
    { id: 'memory_usage', name: 'Memory', native: false, resource_keys: ['k8s:/nodes'], supported_shapes: [0, 1], unit: 1 },
    { id: 'cpu_usage', name: 'CPU', native: false, resource_keys: ['k8s:/nodes'], supported_shapes: [0, 1], unit: 11 },
  ]);
  mocks.query.mockImplementation(options => ({
    data: { results: options.enabled ? options.metricIDs.map((metric_id: string) => ({
      resource_token: options.resources[0]?.token, metric_id,
      status: options.shape === 1 ? 'stale' : metric_id === 'cpu_usage' ? 'missing' : 'partial',
      dimensions: { container: 'app' }, provenance: { native: false, source },
      value: options.shape === 1 ? { time_series: { data_points: [
        { timestamp: new Date(Math.floor(Date.now() / 30_000) * 30_000 - 60_000).toISOString(), value: 1024 },
        { timestamp: new Date(Math.floor(Date.now() / 30_000) * 30_000 - 30_000).toISOString(), value: 2048 },
      ] } } : metric_id === 'cpu_usage' ? undefined : { current_value: { value: 1024 } },
    })) : [] }, error: null, isLoading: false,
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(<QueryClientProvider client={client}><PodMetricsSection connectionID="cluster" resourceKey="k8s:/nodes" resourceID="node" reference={{ address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/nodes', id: 'node', scope: [] }, incarnation: 'uid' }} route={{ connection: 'cluster' }} /></QueryClientProvider>);
  await screen.findByRole('button', { name: 'Memory: Line' });
  const memory = screen.getByRole('button', { name: 'Memory: Line' }).closest('article')!;
  expect(memory.querySelector('[aria-label="Time series area chart"]')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Memory: Line' }));
  expect(memory.querySelector('[aria-label="Time series line chart"]')).not.toBeNull();
  expect(memory.querySelectorAll('g[clip-path] > path')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Memory: Bars' }));
  const bars = memory.querySelectorAll('g[clip-path] > rect');
  expect(bars).toHaveLength(2);
  expect(Number(bars[1].getAttribute('height'))).toBeGreaterThan(Number(bars[0].getAttribute('height')));
  expect(memory.querySelectorAll('g[clip-path] > path')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Memory: Stat' }));
  expect(memory.querySelector('svg[role="img"]')).toBeNull();
  expect(memory.textContent).toContain('1 Ki');
  expect(memory.textContent).toContain('container: app');
  expect(screen.getByRole('button', { name: 'Memory status: partial · stale' })).toBeInTheDocument();
  expect(memory.querySelector('summary')?.textContent).toBe('Details');
  fireEvent.click(screen.getByRole('button', { name: 'CPU: Stat' }));
  expect(container.textContent).toContain('Not reported');
  fireEvent.click(screen.getByRole('button', { name: 'Memory: Area' }));
  expect(memory.querySelector('[aria-label="Time series area chart"]')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'CPU: Stat' }).getAttribute('aria-pressed')).toBe('true');
  client.clear();
});

it('retains unavailable selections across native and external source changes', async () => {
  const user = userEvent.setup();
  mocks.bindings.mockResolvedValue([{ id: 'external', signal: 'metrics', policy: 'replace', source: { plugin_id: 'grafana', connection_id: 'team', datasource_uid: 'a' } }]);
  mocks.definitions.mockResolvedValue([{ id: 'requests', name: 'Requests', native: false, resource_keys: ['k8s:/nodes'], supported_shapes: [0] }]);
  mocks.query.mockReturnValue({ data: { results: [] }, error: null, isLoading: false });
  updateMetricPreferences('k8s:/nodes', previous => ({ ...previous, additional: ['requests'], hidden: ['cpu_usage'] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PodMetricsSection connectionID="cluster" resourceKey="k8s:/nodes" resourceID="node" reference={{ address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/nodes', id: 'node', scope: [] }, incarnation: 'uid' }} route={{ connection: 'cluster' }} /></QueryClientProvider>);
  await screen.findByRole('button', { name: 'Remove Requests' });
  await user.click(screen.getByLabelText('Metric source'));
  await user.click(await screen.findByRole('option', { name: 'Native Kubernetes' }));
  expect(screen.queryByRole('button', { name: 'Remove Requests' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove cpu_usage' })).toBeNull();
  await user.click(screen.getByLabelText('Metric source'));
  await user.click(await screen.findByRole('option', { name: /Connection default/ }));
  expect(await screen.findByRole('button', { name: 'Remove Requests' })).toBeInTheDocument();
  client.clear();
});