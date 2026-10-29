import type { SearchExecutionContextV1, SearchProviderRequestV1, SearchScopeV1 } from '@omniviewdev/runtime';
import type * as Runtime from '@omniviewdev/runtime';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from '@testing-library/react';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@omniviewdev/runtime', async (original) => ({
  ...(await original<typeof Runtime>()),
  useExtensionRegistry: () => undefined,
}));
const clients = vi.hoisted(() => ({ states: vi.fn(), check: vi.fn(), types: vi.fn(), list: vi.fn(), get: vi.fn(), start: vi.fn(), dataGet: vi.fn(), dataSet: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ ResourceClient: {
  GetAllConnectionStates: clients.states, CheckConnection: clients.check, GetResourceTypes: clients.types, List: clients.list, Get: clients.get, StartConnection: clients.start,
}, DataClient: { Get: clients.dataGet, Set: clients.dataSet } }));
vi.mock('../components/kubernetes/KubernetesSearchActionContext', () => ({
  default: () => null, searchActions: async () => [], executeSearchAction: vi.fn(), validateSearchAction: async () => false,
}));
import { kubernetesSearchProvider as provider } from './provider';

const connection: SearchScopeV1 = { kind: 'connection', pluginId: 'kubernetes', connectionId: 'prod', label: 'prod' };
const type: SearchScopeV1 = { ...connection, kind: 'resource-type', resourceKey: 'core::v1::Pod', label: 'Pods' };
function request(scope: SearchScopeV1, query = ''): SearchProviderRequestV1 {
  return { scopes: [connection, ...(scope === connection ? [] : [scope])], query, limit: 20, generation: 1, signal: new AbortController().signal };
}
function context(): SearchExecutionContextV1 {
  return { signal: new AbortController().signal, generation: 1, navigate: vi.fn(), openResource: vi.fn() };
}

let client: QueryClient;
let root: Root;
let container: HTMLDivElement;
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
});

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(React.createElement(QueryClientProvider, { client },
    React.createElement(provider.Context!))));
  clients.states.mockResolvedValue({ kubernetes: [{ connection: { id: 'prod' }, started: true }] });
  clients.check.mockResolvedValue({ status: 'CONNECTED' });
  clients.types.mockResolvedValue({ 'core::v1::Pod': { group: 'core', version: 'v1', kind: 'Pod', label: 'Pods', category: 'Workloads' } });
  clients.dataGet.mockResolvedValue([]);
  clients.dataSet.mockResolvedValue(undefined);
});

describe('Kubernetes scoped provider', () => {
  it('keeps same-named resources from different namespaces distinct and rejects replaced objects', async () => {
    clients.list.mockResolvedValue({ success: true, totalCount: 2, result: [
      { metadata: { name: 'api', namespace: 'one', uid: 'a' } }, { metadata: { name: 'api', namespace: 'two', uid: 'b' } },
    ] });
    const result = await provider.search(request(type, 'api'));
    const rows = result.items.filter(row => row.value.scope?.kind === 'resource');
    expect(rows.map(row => row.value.scope)).toEqual([
      expect.objectContaining({ namespace: 'one', uid: 'a' }), expect.objectContaining({ namespace: 'two', uid: 'b' }),
    ]);
    expect(rows[0].id).not.toBe(rows[1].id);
    const target = rows[0].value.scope;
    if (target?.kind !== 'resource') throw new Error('Expected resource target');
    expect(provider.validateResource!(target, { metadata: { name: 'api', namespace: 'one', uid: 'replacement' } })).toBe(false);
    expect(provider.validateResource!(target, { metadata: { name: 'api', namespace: 'one', uid: 'a' } })).toBe(true);
  });

  it('reports an incomplete scan rather than authoritative no matches', async () => {
    clients.list.mockResolvedValue({ success: true, totalCount: 450, nextCursor: 'more', result: [{ metadata: { name: 'worker', namespace: 'jobs', uid: 'a' } }] });
    const result = await provider.search(request(type, 'missing'));
    expect(result.completion).toBe('truncated');
    expect(result.message).toContain('first 1 resources');
    expect(result.items.map(row => row.label)).toEqual(['Open Pods list matching “missing”']);
  });

  it('blocks reads while disconnected and checks returned readiness after explicit connect', async () => {
    clients.check.mockResolvedValue({ status: 'DISCONNECTED' });
    const result = await provider.search(request(type));
    expect(result.status).toBe('disconnected');
    expect(clients.list).not.toHaveBeenCalled();
    clients.start.mockResolvedValue({ status: 'PENDING' });
    const row = result.items[0];
    if (row.value.kind !== 'action') throw new Error('Expected recovery action');
    await expect(provider.executeAction!(row.value.action, context())).rejects.toThrow('not ready');
  });

  it('does not cancel accepted connection work when search closes', async () => {
    let complete!: (status: { status: string }) => void;
    const cancel = vi.fn();
    const pending = Object.assign(new Promise<{ status: string }>(resolve => { complete = resolve; }), { cancel });
    clients.start.mockReturnValue(pending);
    const controller = new AbortController();
    const execution = { ...context(), signal: controller.signal };
    const result = provider.executeAction!({ id: 'kubernetes:connect', target: connection }, execution);
    await vi.waitFor(() => expect(clients.start).toHaveBeenCalled());
    controller.abort();
    complete({ status: 'CONNECTED' });
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).not.toHaveBeenCalled();
    expect(execution.navigate).not.toHaveBeenCalled();
  });

  it('keeps navigation usable when history storage fails and transfers exact list text', async () => {
    clients.dataGet.mockRejectedValue(new Error('Storage unavailable'));
    const execution = context();
    await provider.executeAction!({ id: 'kubernetes:open-list', query: 'api & jobs', target: type }, execution);
    expect(execution.navigate).toHaveBeenCalledWith({ kind: 'plugin', pluginId: 'kubernetes', path: '/cluster/prod/resources/core_v1_Pod?search=api+%26+jobs' });
  });

  it.each([
    ['UNAUTHORIZED', 'authentication-required'],
    ['FORBIDDEN', 'forbidden'],
    ['PENDING', 'connecting'],
  ])('shows %s readiness without listing or auto-connecting', async (status, expected) => {
    clients.check.mockResolvedValue({ status });
    const result = await provider.search(request(type));
    expect(result.status).toBe(expected);
    expect(clients.list).not.toHaveBeenCalled();
    expect(clients.start).not.toHaveBeenCalled();
  });

  it('retains exact long Unicode filters without oversized action identifiers', async () => {
    const query = '😀'.repeat(256);
    clients.list.mockResolvedValue({ success: true, totalCount: 0, result: [] });
    const result = await provider.search(request(type, query));
    const row = result.items[0];
    expect(row.id).toBe('kubernetes:open-list');
    if (row.value.kind !== 'action') throw new Error('Expected list action');
    expect(row.value.action.query).toBe(query);
    expect(row.label.length).toBeLessThan(256);
    const execution = context();
    await provider.executeAction!(row.value.action, execution);
    const target = vi.mocked(execution.navigate).mock.calls[0][0];
    if (target.kind !== 'plugin') throw new Error('Expected plugin target');
    expect(new URLSearchParams(target.path.split('?')[1]).get('search')).toBe(query);
  });

  it('does not trust retained watch metadata after connection stops', async () => {
    clients.check.mockResolvedValue({ status: 'DISCONNECTED' });
    const result = await provider.search(request(type));
    expect(result.status).toBe('disconnected');
    expect(clients.list).not.toHaveBeenCalled();
  });

  it('rejects scopes outside Kubernetes without reading connections', async () => {
    const result = await provider.search(request({ ...connection, pluginId: 'other' }));
    expect(result.items).toEqual([]);
    expect(clients.states).not.toHaveBeenCalled();
  });

  it('reuses one canonical list snapshot across queries and refetches after invalidation', async () => {
    clients.list.mockResolvedValue({ success: true, totalCount: 1, result: [{ metadata: { name: 'api', namespace: 'one' } }] });
    await provider.search(request(type, 'a'));
    await provider.search(request(type, 'api'));
    expect(clients.list).toHaveBeenCalledTimes(1);
    expect(clients.check).toHaveBeenCalledTimes(1);
    expect(clients.states).not.toHaveBeenCalled();
    const key = ['kubernetes', 'prod', 'core::v1::Pod', [], 'list'];
    expect(client.getQueryData(key)).toMatchObject({ success: true, totalCount: 1 });
    await client.invalidateQueries({ queryKey: key.slice(0, 3) });
    await provider.search(request(type, 'api'));
    expect(clients.list).toHaveBeenCalledTimes(2);
  });

  it('fences cancelled searches without cancelling shared native list reads', async () => {
    const { promise, resolve: complete } = Promise.withResolvers<unknown>();
    const cancel = vi.fn();
    clients.list.mockReturnValue(Object.assign(promise, { cancel }));
    const controller = new AbortController();
    const first = provider.search({ ...request(type), signal: controller.signal });
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(clients.list).toHaveBeenCalledTimes(1));
    controller.abort();
    const second = provider.search(request(type, 'api'));
    complete({ success: true, totalCount: 0, result: [] });
    await rejected;
    await second;
    expect(cancel).not.toHaveBeenCalled();
    expect(clients.list).toHaveBeenCalledTimes(1);
  });

  it('uses the query signal to cancel native work when the cache cancels', async () => {
    const cancel = vi.fn();
    clients.list.mockReturnValue(Object.assign(Promise.withResolvers<unknown>().promise, { cancel }));
    const pending = Promise.allSettled([provider.search(request(type))]);
    await vi.waitFor(() => expect(clients.list).toHaveBeenCalledTimes(1));
    await client.cancelQueries({ queryKey: ['kubernetes', 'prod', 'core::v1::Pod'] });
    await pending;
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('never uses cached readiness as execution authorization', async () => {
    clients.list.mockResolvedValue({ success: true, totalCount: 0, result: [] });
    await provider.search(request(type));
    clients.check.mockResolvedValue({ status: 'DISCONNECTED' });
    const execution = context();
    await expect(provider.executeAction!({ id: 'kubernetes:open-list', target: type }, execution)).rejects.toThrow('disconnected');
    expect(clients.check).toHaveBeenCalledTimes(2);
    expect(execution.navigate).not.toHaveBeenCalled();
  });

  it('invalidates cached readiness after explicit connection recovery', async () => {
    clients.check.mockResolvedValue({ status: 'DISCONNECTED' });
    await provider.search(request(type));
    clients.start.mockResolvedValue({ status: 'CONNECTED' });
    await provider.executeAction!({ id: 'kubernetes:connect', target: connection, recovery: 'connection' }, context());
    clients.check.mockResolvedValue({ status: 'CONNECTED' });
    clients.list.mockResolvedValue({ success: true, totalCount: 0, result: [] });
    await provider.search(request(type));
    expect(clients.check).toHaveBeenCalledTimes(2);
    expect(clients.list).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ status: 'ERROR', error: 'client is required' }, 'disconnected'],
    [{ status: 'ERROR', details: 'DiscoveryClient is not initialized' }, 'unavailable'],
    [{ status: 'ERROR', error: 'connection is required' }, 'unavailable'],
  ])('preserves explicit recovery for native status %j', async (status, expected) => {
    clients.check.mockResolvedValue(status);
    const result = await provider.search(request(type));
    expect(result.status).toBe(expected);
    if (expected === 'disconnected') expect(result.items[0].value).toMatchObject({ kind: 'action', action: { recovery: 'connection' } });
    else expect(result.items).toEqual([]);
    expect(clients.list).not.toHaveBeenCalled();
  });

  it('reuses one canonical object snapshot while filtering action queries', async () => {
    const scope: SearchScopeV1 = { ...connection, kind: 'resource', resourceKey: 'core::v1::Pod',
      resourceId: 'api', namespace: 'apps', uid: 'original', label: 'api' };
    clients.get.mockResolvedValue({ success: true, result: { metadata: { name: 'api', namespace: 'apps', uid: 'original' } } });
    await provider.search(request(scope, 'o'));
    await provider.search(request(scope, 'open'));
    expect(clients.get).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['kubernetes', 'prod', 'core::v1::Pod', 'apps', 'api'])).toMatchObject({ success: true });
    await client.invalidateQueries({ queryKey: ['kubernetes', 'prod', 'core::v1::Pod'] });
    await provider.search(request(scope, 'open'));
    expect(clients.get).toHaveBeenCalledTimes(2);
  });

  it('does not reconnect for a replaced object or unrelated object read failure', async () => {
    const scope: SearchScopeV1 = { ...connection, kind: 'resource', resourceKey: 'core::v1::Pod',
      resourceId: 'api', namespace: 'apps', uid: 'original', label: 'api' };
    clients.get.mockResolvedValueOnce({ success: true, result: { metadata: { name: 'api', namespace: 'apps', uid: 'replacement' } } });
    const replaced = await provider.search(request(scope));
    expect(replaced.message).toContain('removed or replaced');
    expect(replaced.items).toEqual([]);
    await client.invalidateQueries({ queryKey: ['kubernetes', 'prod', 'core::v1::Pod'] });
    clients.get.mockRejectedValueOnce(new Error('Object read failed'));
    const failed = await provider.search(request(scope));
    expect(failed.status).toBe('unavailable');
    expect(failed.items).toEqual([]);
  });

});
