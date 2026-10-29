import React, { type PropsWithChildren } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: { QueryAll: transport.query } }));
import { usePodMetricsBatch } from './usePodMetricsBatch';

let client: QueryClient;
let visibility: DocumentVisibilityState;
function Wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
async function show(value: DocumentVisibilityState) {
  visibility = value;
  // Native visibilitychange bubbles to TanStack Query's window focus listener.
  await act(async () => { document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  transport.query.mockReset();
  transport.query.mockImplementation(async (connectionID: string, _key: string, _id: string, namespace: string) => ({
    fixture: { success: true, results: [
      { current_value: { metric_id: 'cpu_usage', value: connectionID === 'a' ? 12 : 27, labels: { namespace: namespace || 'default', pod: 'pod' } } },
      { current_value: { metric_id: 'memory_usage', value: 4096, labels: { namespace: namespace || 'default', pod: 'pod' } } },
    ] },
  }));
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Pod metrics acquisition', () => {
  it('starts disabled without an initial request and acquires when a metric becomes visible', async () => {
    const hook = renderHook(({ enabled }) => usePodMetricsBatch({ connectionID: 'a', enabled }), {
      wrapper: Wrapper, initialProps: { enabled: false },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(transport.query).not.toHaveBeenCalled();
    hook.rerender({ enabled: true });
    await settle();
    expect(transport.query).toHaveBeenCalledTimes(1);
    expect(hook.result.current.metricsMap.get('default/pod')).toEqual({ cpuMillicores: 12, memoryBytes: 4096 });
    hook.rerender({ enabled: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(transport.query).toHaveBeenCalledTimes(1);
    hook.rerender({ enabled: true });
    await settle();
    expect(transport.query).toHaveBeenCalledTimes(2);
  });

  it('does not acquire in a hidden document and resumes stale data once', async () => {
    visibility = 'hidden';
    renderHook(() => usePodMetricsBatch({ connectionID: 'a' }), { wrapper: Wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(transport.query).not.toHaveBeenCalled();
    await show('visible');
    expect(transport.query).toHaveBeenCalledTimes(1);
    await show('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(transport.query).toHaveBeenCalledTimes(1);
    await show('visible');
    expect(transport.query).toHaveBeenCalledTimes(2);
  });

  it('never presents previous connection or namespace data while new metrics are pending', async () => {
    const hook = renderHook(({ connectionID, namespace }) => usePodMetricsBatch({ connectionID, namespace }), {
      wrapper: Wrapper, initialProps: { connectionID: 'a', namespace: 'first' },
    });
    await settle();
    expect(hook.result.current.metricsMap.get('first/pod')?.cpuMillicores).toBe(12);
    const { promise, resolve: finish } = Promise.withResolvers<object>();
    transport.query.mockImplementationOnce(() => promise);
    hook.rerender({ connectionID: 'b', namespace: 'second' });
    expect(hook.result.current.metricsMap.size).toBe(0);
    await act(async () => { finish({}); });
    await settle();
    expect(hook.result.current.metricsMap.size).toBe(0);
  });

  it('reports controlled request counts through the real hook and query client', async () => {
    visibility = 'hidden';
    const hook = renderHook(({ enabled, connectionID }) => usePodMetricsBatch({ connectionID, enabled }), {
      wrapper: Wrapper, initialProps: { enabled: true, connectionID: 'a' },
    });
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    const initialHidden = transport.query.mock.calls.length;
    await show('visible');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    const visible = transport.query.mock.calls.length - initialHidden;
    const beforeColumnsHidden = transport.query.mock.calls.length;
    hook.rerender({ enabled: false, connectionID: 'a' });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    const columnsHidden = transport.query.mock.calls.length - beforeColumnsHidden;
    hook.rerender({ enabled: true, connectionID: 'a' });
    await settle();
    await show('hidden');
    const beforeHidden = transport.query.mock.calls.length;
    hook.rerender({ enabled: true, connectionID: 'b' });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    const hiddenConnectionSwitch = transport.query.mock.calls.length - beforeHidden;
    await show('visible');
    expect(initialHidden).toBe(0);
    expect(visible).toBeGreaterThan(0);
    expect(columnsHidden).toBe(0);
    expect(hiddenConnectionSwitch).toBe(0);
    expect(hook.result.current.metricsMap.get('default/pod')?.memoryBytes).toBe(4096);
  });
});
