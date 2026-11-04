import { createElement, type PropsWithChildren } from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { MetricBinding, ResourceMetricResult } from '@omniviewdev/runtime';
import { usePodResourceSetMetrics } from './usePodMetricsBatch';

const mocks = vi.hoisted(() => ({ bindings: vi.fn(), definitions: vi.fn(), query: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: { GetMetricBindings: mocks.bindings, GetMetricDefinitions: mocks.definitions } }));
vi.mock('@omniviewdev/runtime', () => ({ useResourceSetMetrics: mocks.query }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('keeps native results only for supplement while excluding another external binding', async () => {
  const binding = { id: 'selected', signal: 'metrics', policy: 'supplement', source: { plugin_id: 'grafana', connection_id: 'team', datasource_uid: 'a' } } as MetricBinding;
  const native = { metric_id: 'cpu_usage', provenance: { native: true }, status: 'missing' } as ResourceMetricResult;
  const external = { metric_id: 'network_rx', provenance: { native: false, binding_id: 'selected' }, status: 'ok' } as ResourceMetricResult;
  const foreign = { metric_id: 'memory_usage', provenance: { native: false, binding_id: 'other' }, status: 'ok' } as ResourceMetricResult;
  mocks.bindings.mockResolvedValue([binding]);
  mocks.definitions.mockResolvedValue([]);
  mocks.query.mockReturnValue({ data: { results: [native, external, foreign] }, error: null, isLoading: false });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) { return createElement(QueryClientProvider, { client }, children); }
  const hook = renderHook(() => usePodResourceSetMetrics({ connectionID: 'cluster', resources: [{ token: 'pod', resource_key: 'k8s:/pods', resource_id: 'pod', resource_namespace: 'default' }] }), { wrapper: Wrapper });
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  expect(hook.result.current.data?.results).toEqual([native, external]);
  client.setQueryData(['metric', 'bindings', 'kubernetes', 'cluster'], [{ ...binding, policy: 'replace' }]);
  await waitFor(() => expect(hook.result.current.data?.results).toEqual([external]));
  hook.unmount(); client.clear();
});
