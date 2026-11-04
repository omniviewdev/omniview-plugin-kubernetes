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
