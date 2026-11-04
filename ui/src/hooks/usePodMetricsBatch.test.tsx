import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import type { HostRecord, ResourceMetricResult } from '@omniviewdev/runtime';
const mocks = vi.hoisted(() => ({ bindings: vi.fn(), definitions: vi.fn(), query: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: { GetMetricBindings: mocks.bindings, GetMetricDefinitions: mocks.definitions } }));
vi.mock('@omniviewdev/runtime', () => ({ useResourceSetMetrics: mocks.query }));
vi.mock('./useDocumentVisibility', () => ({ useDocumentVisibility: () => true }));
import { podMetricResource, podMetricsMap, usePodResourceSetMetrics } from './usePodMetricsBatch';
import { PLUGIN_ID } from '@/pluginId';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function record(namespace: string, authority = 'cluster-a'): HostRecord {
  return { key: 'opaque-host-key', addressKey: 'opaque-address', targetId: 'target', route: { connection: authority },
    record: { reference: { address: { provider: 'kubernetes', authority, type: 'k8s:/pods', id: 'same', scope: [{ dimension: 'namespace', value: namespace }] }, incarnation: 'uid' } },
  } as HostRecord;
}
function result(resource_token: string, metric_id: string, status: string, value?: number) {
  return { resource_token, metric_id, status, provenance: { native: true },
    ...(value === undefined ? {} : { value: { current_value: { value } } }),
  } as ResourceMetricResult;
}

describe('finite pod metric identity', () => {
  it('retains canonical route, namespace, and incarnation without parsing opaque host keys', () => {
    const source = record('team');
    const resource = podMetricResource(source);
    expect(resource.reference).toBe(source.record.reference);
    expect(resource.route).toBe(source.route);
    expect(resource.resource_id).toBe('same');
    expect(resource.resource_namespace).toBe('team');
    expect(resource).not.toHaveProperty('public_data');
    expect(resource.token).not.toBe(podMetricResource(record('other')).token);
    expect(resource.token).not.toBe(podMetricResource(record('team', 'cluster-b')).token);
  });
  it('keeps missing distinct from measured zero and rejects foreign resource results', () => {
    const first = podMetricResource(record('first'));
    const second = podMetricResource(record('second'));
    const map = podMetricsMap([first, second], [
      result(first.token, 'cpu_usage', 'ok', 0),
      result(first.token, 'memory_usage', 'missing'),
      result(second.token, 'cpu_usage', 'denied'),
      result('foreign', 'cpu_usage', 'ok', 999),
    ]);
    expect(map.size).toBe(2);
    expect(map.get('first/same')?.cpu?.value?.current_value?.value).toBe(0);
    expect(map.get('first/same')?.memory?.status).toBe('missing');
    expect(map.get('first/same')?.memory?.value).toBeUndefined();
    expect(map.get('second/same')?.cpu?.status).toBe('denied');
  });
  it('never displays a container series as the pod total in either result order', () => {
    const resource = podMetricResource(record('team'));
    const containers = [
      { ...result(resource.token, 'cpu_usage', 'ok', 10), dimensions: { container: 'first' } },
      { ...result(resource.token, 'cpu_usage', 'ok', 20), dimensions: { container: 'second' } },
    ];
    for (const series of [containers, [...containers].reverse(), containers.slice(0, 1)]) {
      const cpu = podMetricsMap([resource], series).get('team/same')?.cpu;
      expect(cpu?.status).toBe('ambiguous');
      expect(cpu?.value).toBeUndefined();
    }
  });
  it('rejects duplicate aggregate samples instead of picking the last result', () => {
    const resource = podMetricResource(record('team'));
    const cpu = podMetricsMap([resource], [
      result(resource.token, 'cpu_usage', 'ok', 10),
      result(resource.token, 'cpu_usage', 'ok', 20),
    ]).get('team/same')?.cpu;
    expect(cpu?.status).toBe('ambiguous');
    expect(cpu?.value).toBeUndefined();
  });
  it('keeps source totals separate and never hides external failure with native success', () => {
    const resource = podMetricResource(record('team'));
    const native = result(resource.token, 'cpu_usage', 'ok', 30);
    const external = { ...result(resource.token, 'cpu_usage', 'ok', 10), provenance: { native: false, binding_id: 'selected' } } as ResourceMetricResult;
    for (const series of [[native, external], [external, native]]) {
      const cpu = podMetricsMap([resource], series).get('team/same')?.cpu;
      expect(cpu?.value?.current_value?.value).toBe(10);
      expect(cpu?.provenance.native).toBe(false);
    }
    const denied = { ...external, status: 'denied', value: undefined } as ResourceMetricResult;
    const cpu = podMetricsMap([resource], [native, denied]).get('team/same')?.cpu;
    expect(cpu?.status).toBe('denied');
    expect(cpu?.value).toBeUndefined();
  });
});

describe('resource-set acquisition admission', () => {
  it.each(['native', undefined])('acquires %s native metrics despite external catalog failure', async bindingID => {
    mocks.bindings.mockResolvedValue(bindingID === 'native'
      ? [{ id: 'saved', signal: 'metrics', policy: 'replace', source: { plugin_id: 'grafana' } }]
      : []);
    mocks.definitions.mockRejectedValue(new Error('Unrelated provider catalog failed'));
    const native = result('pod', 'cpu_usage', 'ok', 42);
    mocks.query.mockImplementation(request => ({ data: request ? { results: [native] } : undefined, error: null, isLoading: false }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await client.fetchQuery({ queryKey: ['metric', 'definitions'], queryFn: mocks.definitions }).catch(() => undefined);
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result: query } = renderHook(() => usePodResourceSetMetrics({
      connectionID: 'cluster', resources: [podMetricResource(record('team'))], bindingID,
    }), { wrapper });
    await waitFor(() => expect(query.current.data?.results).toEqual([native]));
    expect(query.current.error).toBeNull();
    expect(mocks.query.mock.calls.at(-1)?.[0].binding_id).toBe(bindingID === 'native' ? 'native' : '');
    client.clear();
  });

  it('keeps saved replace binding authoritative without catalog admission in the consumer', async () => {
    mocks.bindings.mockResolvedValue([{ id: 'saved', signal: 'metrics', policy: 'replace', revision: 'r2', source: { plugin_id: 'grafana' } }]);
    const native = result('pod', 'cpu_usage', 'ok', 42);
    const external = { ...native, provenance: { native: false, binding_id: 'saved' } };
    mocks.query.mockImplementation(request => ({ data: request ? { results: [native, external] } : undefined, error: null, isLoading: false }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result: query } = renderHook(() => usePodResourceSetMetrics({
      connectionID: 'cluster', resources: [podMetricResource(record('team'))],
    }), { wrapper });
    await waitFor(() => expect(query.current.data?.results).toEqual([external]));
    expect(mocks.query.mock.calls.at(-1)?.[0]).toMatchObject({ binding_id: 'saved', mapping_revision: 'r2', source: { plugin_id: 'grafana' } });
    client.clear();
  });

  it('rejects missing saved binding rather than acquiring native metrics', async () => {
    mocks.bindings.mockResolvedValue([]);
    mocks.query.mockReturnValue({ error: null, isLoading: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result: query } = renderHook(() => usePodResourceSetMetrics({
      connectionID: 'cluster', resources: [podMetricResource(record('team'))], bindingID: 'removed',
    }), { wrapper });
    await waitFor(() => expect(query.current.error?.message).toBe('Selected metric binding is unavailable'));
    expect(mocks.query.mock.calls.every(([request]) => request === undefined)).toBe(true);
    client.clear();
  });
});

describe('rolling history continuity', () => {
  function setup(bindingID = 'native') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['metric', 'bindings', PLUGIN_ID, 'cluster'], []);
    mocks.bindings.mockResolvedValue([]);
    const resource = podMetricResource(record('team'));
    const history = { ...result(resource.token, 'cpu_usage', 'ok'), expires_at: '2026-11-04T12:05:00Z', value: {
      time_series: { data_points: [{ timestamp: '2026-11-04T12:00:00Z', value: 1 }] },
    } } as ResourceMetricResult;
    let snapshot: { data?: { results: ResourceMetricResult[] }; error: Error | null; isLoading: boolean; isFetching: boolean } =
      { data: { results: [history] }, error: null, isLoading: false, isFetching: false };
    mocks.query.mockImplementation(request => request ? snapshot : { isLoading: false, isFetching: false, error: null });
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const initialProps = { connectionID: 'cluster', resources: [resource], bindingID, metricIDs: ['cpu_usage'],
      shape: 1, startTime: '2026-11-04T11:00:00Z', endTime: '2026-11-04T12:00:00Z' };
    const hook = renderHook(props => usePodResourceSetMetrics(props), { initialProps, wrapper });
    return { ...hook, client, history, initialProps, setSnapshot: (next: typeof snapshot) => { snapshot = next; } };
  }

  it('retains history freshness during a deferred rolling refresh, then replaces it with resolved samples', async () => {
    const hook = setup();
    await waitFor(() => expect(hook.result.current.data?.results).toEqual([hook.history]));
    hook.setSnapshot({ error: null, isLoading: true, isFetching: true });
    hook.rerender({ ...hook.initialProps, startTime: '2026-11-04T11:00:30Z', endTime: '2026-11-04T12:00:30Z' });
    expect(hook.result.current.data?.results[0]).toBe(hook.history);
    expect(hook.result.current.isLoading).toBe(false);
    expect(hook.result.current.isFetching).toBe(true);
    const { promise: pending, resolve } = Promise.withResolvers<{ results: ResourceMetricResult[] }>();
    const updated = { ...hook.history, value: { time_series: { data_points: [{ timestamp: '2026-11-04T12:00:30Z', value: 2 }] } } } as ResourceMetricResult;
    resolve({ results: [updated] });
    hook.setSnapshot({ data: await pending, error: null, isLoading: false, isFetching: false });
    hook.rerender({ ...hook.initialProps, startTime: '2026-11-04T11:00:30Z', endTime: '2026-11-04T12:00:30Z' });
    expect(hook.result.current.data?.results).toEqual([updated]);
    hook.client.clear();
  });

  it.each(['resource', 'source', 'sourceDetails', 'metrics', 'duration', 'step', 'mapping'])('clears prior history immediately after %s changes', async change => {
    const hook = setup();
    await waitFor(() => expect(hook.result.current.data?.results).toEqual([hook.history]));
    hook.setSnapshot({ error: null, isLoading: true, isFetching: true });
    if (change === 'mapping' || change === 'sourceDetails') {
      hook.client.setQueryData(['metric', 'bindings', PLUGIN_ID, 'cluster'], [
        { id: 'native', signal: 'metrics', revision: change === 'mapping' ? 'new' : '', source: { plugin_id: 'grafana', datasource_uid: 'other' } },
      ]);
    }
    hook.rerender({ ...hook.initialProps,
      ...(change === 'resource' ? { resources: [podMetricResource(record('other'))] } : {}),
      ...(change === 'source' ? { bindingID: 'other' } : {}),
      ...(change === 'metrics' ? { metricIDs: ['memory_usage'] } : {}),
      ...(change === 'duration' ? { startTime: '2026-11-04T10:00:00Z' } : {}),
      ...(change === 'step' ? { step: 60 } : {}),
    });
    if (change === 'mapping' || change === 'sourceDetails') await waitFor(() => expect(hook.result.current.data).toBeUndefined());
    else expect(hook.result.current.data).toBeUndefined();
    hook.client.clear();
  });

  it('does not mask settled empty or denied results, and keeps background errors visible', async () => {
    const hook = setup();
    await waitFor(() => expect(hook.result.current.data?.results).toEqual([hook.history]));
    const error = new Error('Provider unavailable');
    hook.setSnapshot({ error, isLoading: false, isFetching: false });
    hook.rerender(hook.initialProps);
    expect(hook.result.current.error).toBe(error);
    expect(hook.result.current.data?.results[0]).toBe(hook.history);
    hook.setSnapshot({ data: { results: [] }, error: null, isLoading: false, isFetching: false });
    hook.rerender(hook.initialProps);
    expect(hook.result.current.data?.results).toEqual([]);
    const denied = { ...hook.history, status: 'denied', value: undefined } as ResourceMetricResult;
    hook.setSnapshot({ data: { results: [denied] }, error: null, isLoading: false, isFetching: false });
    hook.rerender(hook.initialProps);
    expect(hook.result.current.data?.results).toEqual([denied]);
    hook.setSnapshot({ error, isLoading: false, isFetching: false });
    hook.rerender(hook.initialProps);
    expect(hook.result.current.data).toBeUndefined();
    expect(hook.result.current.error).toBe(error);
    hook.client.clear();
  });

  it.each(['stale', 'partial'])('preserves provider %s status and deadline during refresh', async status => {
    const hook = setup();
    const providerResult = { ...hook.history, status } as ResourceMetricResult;
    hook.setSnapshot({ data: { results: [providerResult] }, error: null, isLoading: false, isFetching: false });
    hook.rerender(hook.initialProps);
    await waitFor(() => expect(hook.result.current.data?.results[0]).toBe(providerResult));
    hook.setSnapshot({ error: null, isLoading: true, isFetching: true });
    hook.rerender({ ...hook.initialProps, startTime: '2026-11-04T11:00:30Z', endTime: '2026-11-04T12:00:30Z' });
    expect(hook.result.current.data?.results[0]).toBe(providerResult);
    expect(hook.result.current.data?.results[0].expires_at).toBe(hook.history.expires_at);
    hook.client.clear();
  });
});
