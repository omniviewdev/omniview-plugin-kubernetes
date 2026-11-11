import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonToValue, type SearchScopeV1, type SearchExecutionContextV1 } from '@omniviewdev/runtime';
const clients = vi.hoisted(() => ({ check: vi.fn(), catalog: vi.fn(), enumerate: vi.fn(), get: vi.fn(), resolve: vi.fn(), start: vi.fn(), dataGet: vi.fn(), dataSet: vi.fn() }));
vi.mock('@omniviewdev/runtime', async original => ({ ...(await original<object>()), useExtensionRegistry: () => undefined }));
vi.mock('@omniviewdev/runtime/api', () => ({ ResourceClient: { CheckConnection: clients.check, Catalog: clients.catalog, Enumerate: clients.enumerate, Get: clients.get, ResolveTarget: clients.resolve, StartConnection: clients.start }, DataClient: { Get: clients.dataGet, Set: clients.dataSet } }));
vi.mock('../components/kubernetes/KubernetesSearchActionContext', () => ({ default: () => null, searchActions: async () => [], executeSearchAction: vi.fn(), validateSearchAction: async () => false }));
import { kubernetesSearchProvider as provider } from './provider';
const connection: SearchScopeV1 = { kind: 'connection', pluginId: 'kubernetes', connectionId: 'prod', label: 'prod' };
const target = { route: { connection: 'prod' }, provider: 'kubernetes', authority: 'host-authority', type: 'k8s:/pods', scope: [], representation: 'native' };
const type: Extract<SearchScopeV1, {kind: 'resource-type'}> = { kind: 'resource-type', pluginId: 'kubernetes', target, targetId: 'host-target', label: 'Pods' };
function record(namespace: string, uid: string) {
  return { key: `host-key-${namespace}`, addressKey: `host-address-${namespace}`, targetId: type.targetId, route: target.route,
    record: { reference: { address: { provider: target.provider, authority: target.authority, type: target.type, scope: [{ dimension: 'namespace', value: namespace }], id: 'api' }, incarnation: uid }, body: jsonToValue({ metadata: { name: 'api', namespace, uid } }), representation: { id: 'native', revision: 'format-1' }, coverage: { kind: 'complete', paths: [] } } };
}
function request(scope: SearchScopeV1, query = '') { return { scopes: [connection, scope], query, limit: 20, generation: 1, signal: new AbortController().signal }; }
const context = (): SearchExecutionContextV1 => ({ signal: new AbortController().signal, generation: 1, navigate: vi.fn(), openResource: vi.fn() });
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  render(React.createElement(QueryClientProvider, { client: new QueryClient({defaultOptions:{queries:{retry:false}}}) }, React.createElement(provider.Context!)));
  clients.check.mockResolvedValue({ status: 'CONNECTED' });
  clients.catalog.mockResolvedValue({ types: [{type: target.type, displayName: 'Pods', representations: [{id: 'native'}]}] });
  clients.dataGet.mockResolvedValue([]);
});
describe('canonical Kubernetes search', () => {
  it('keeps host keys, canonical references, and native namespace guards', async () => {
    clients.enumerate.mockResolvedValue({ records: [record('one', 'a'), record('two', 'b')], sourcePage: { count: {kind:'exact',value:'2'}, coverage: {kind:'complete'} } });
    const result = await provider.search(request(type, 'api'));
    const rows = result.items.filter(row => row.value.scope?.kind === 'resource');
    expect(rows.map(row => row.id)).toEqual(['host-key-one', 'host-key-two']);
    const scope = rows[0].value.scope!;
    if (scope.kind !== 'resource') throw new Error('Expected resource');
    expect(scope.targetId).toBe('host-target');
    expect(scope.reference.incarnation).toBe('a');
    expect(provider.validateResource!(scope, {metadata:{name:'api',namespace:'one',uid:'replacement'}})).toBe(false);
    expect(provider.validateResource!(scope, {metadata:{name:'api',namespace:'one',uid:'a'}})).toBe(true);
    expect(clients.enumerate).toHaveBeenCalledWith('kubernetes', {targetId:type.targetId,request:{target,pageSize:200}});
  });
  it('discloses unknown count and bounded local ranking without compiling a host query', async () => {
    clients.enumerate.mockResolvedValue({records:[record('one','a')],sourcePage:{count:{kind:'unknown'},coverage:{kind:'partial'},nextCursor:'more'}});
    const result = await provider.search(request(type,'missing'));
    expect(result.completion).toBe('truncated');
    expect(result.message).toContain('not a host query');
    expect(result.items).toHaveLength(1);
  });
  it.each(['UNAUTHORIZED','FORBIDDEN','PENDING','DISCONNECTED'])('does not read resources while %s', async status => {
    clients.check.mockResolvedValue({status});
    await provider.search(request(type));
    expect(clients.enumerate).not.toHaveBeenCalled();
    expect(clients.start).not.toHaveBeenCalled();
  });
  it('preserves literal list filters when history fails', async () => {
    clients.dataGet.mockRejectedValue(new Error('Storage unavailable'));
    const execution = context();
    await provider.executeAction!({id:'kubernetes:open-list',query:'api & jobs',target:type},execution);
    expect(execution.navigate).toHaveBeenCalledWith({kind:'plugin',pluginId:'kubernetes',path:'/cluster/prod/resources/k8s%3A%2Fpods?search=api+%26+jobs'});
  });
  it('rejects returned records from another admitted target', async () => {
    clients.enumerate.mockResolvedValue({records:[{...record('one','a'),targetId:'wrong'}],sourcePage:{}});
    const result = await provider.search(request(type));
    expect(result.status).toBe('unavailable');
  });
  it('admits catalog destinations through host ResolveTarget', async () => {
    clients.resolve.mockResolvedValue({ target, targetId: type.targetId, authority: { continuity: 'connectionLocal', limitations: [] } });
    const result = await provider.search(request(connection, 'Pods'));
    const scope = result.items[0].value.scope;
    expect(scope).toMatchObject(type);
    expect(clients.resolve).toHaveBeenCalledWith('kubernetes', {
      route: target.route, type: 'k8s:/pods', representation: 'native',
    });
  });
  it('uses the catalog UI default when raw and model representations coexist', async () => {
    clients.catalog.mockResolvedValue({ types: [{
      type: target.type, displayName: 'Pods', defaultRepresentation: 'raw-v1',
      representations: [{ id: 'raw-v1' }, { id: 'model-v1' }],
    }] });
    clients.resolve.mockResolvedValue({ target: { ...target, representation: 'raw-v1' }, targetId: type.targetId });
    await provider.search(request(connection, 'Pods'));
    expect(clients.resolve).toHaveBeenCalledWith('kubernetes', {
      route: target.route, type: target.type, representation: 'raw-v1',
    });
  });
  it('does not guess among representations without a declared default', async () => {
    clients.catalog.mockResolvedValue({ types: [{
      type: target.type, displayName: 'Pods', representations: [{ id: 'raw-v1' }, { id: 'model-v1' }],
    }] });
    const result = await provider.search(request(connection, 'Pods'));
    expect(result.status).toBe('unavailable');
    expect(clients.resolve).not.toHaveBeenCalled();
  });
});
