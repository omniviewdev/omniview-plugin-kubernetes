import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useKubernetesResources } from './useKubernetesResources';

vi.mock('@/pluginId', () => ({ PLUGIN_ID: 'kubernetes-preview' }));

const mocks = vi.hoisted(() => ({
  types: vi.fn(), resolve: vi.fn(), resources: vi.fn(), decode: vi.fn(),
}));
vi.mock('@omniviewdev/runtime', () => ({
  useResourceTypes: (options: unknown) => ({ resourceTypes: mocks.types(options) }),
  useResolvedResourceTarget: mocks.resolve,
  useResources: (options: { request?: unknown }) => {
    const result = mocks.resources(options);
    return { ...result, acquired: options.request && result.resources.data ? { request: options.request, page: result.resources.data } : undefined };
  },
  valueToJSON: mocks.decode,
}));

describe('useKubernetesResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.types.mockReturnValue({ data: [{
      type: 'k8s:/pods', queryDimensions: [{ name: 'namespace' }],
      representations: [{ id: 'native' }], defaultRepresentation: 'native',
      capabilities: [{ operation: 'sourceUpdates' }],
    }], isLoading: false });
    mocks.resolve.mockReturnValue({ data: {
      targetId: 'host-membership', target: { authority: 'host-authority' },
    }, isLoading: false });
    mocks.resources.mockReturnValue({ resources: {
      data: { records: [{ key: 'host-key', record: { body: { kind: 'int64', value: '9007199254740993' } } }] },
      isLoading: false,
    } });
    mocks.decode.mockReturnValue(9007199254740993n);
  });

  it('uses explicit route, declared namespace dimension, and host membership for live reads', () => {
    const { result } = renderHook(() => useKubernetesResources({
      connectionID: 'selected-cluster', resourceType: 'k8s:/pods', namespaces: ['team'],
    }));
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({
      pluginID: 'kubernetes-preview',
      route: { connection: 'selected-cluster' }, type: 'k8s:/pods', representation: 'native',
      scope: [{ dimension: 'namespace', match: 'oneOf', values: ['team'] }],
    }));
    expect(mocks.resources).toHaveBeenCalledWith(expect.objectContaining({
      pluginID: 'kubernetes-preview',
      request: { targetId: 'host-membership', request: { target: { authority: 'host-authority' }, pageSize: 200 } },
      live: true, collection: true,
    }));
    expect(result.current.bodies).toEqual([9007199254740993n]);
    expect(mocks.types).toHaveBeenCalledWith({
      pluginID: 'kubernetes-preview', route: { connection: 'selected-cluster' },
    });
    expect(result.current.records[0].key).toBe('host-key');
  });

  it('does not add namespace scope to cluster-scoped types', () => {
    mocks.types.mockReturnValue({ data: [{
      type: 'k8s:/nodes', queryDimensions: [], representations: [{ id: 'native' }], defaultRepresentation: 'native',
      capabilities: [],
    }], isLoading: false });
    renderHook(() => useKubernetesResources({
      connectionID: 'selected-cluster', resourceType: 'k8s:/nodes', namespaces: ['team'],
    }));
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ scope: [] }));
    expect(mocks.resources).toHaveBeenCalledWith(expect.objectContaining({ live: false }));
  });

  it('uses an unconstrained namespace dimension when no namespaces are selected', () => {
    renderHook(() => useKubernetesResources({
      connectionID: 'selected-cluster', resourceType: 'k8s:/pods',
    }));
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({
      route: { connection: 'selected-cluster' },
      scope: [{ dimension: 'namespace', match: 'any' }],
    }));
  });

  it('exposes catalog failure rather than presenting an empty successful collection', () => {
    const error = new Error('Catalog unavailable');
    mocks.types.mockReturnValue({ data: undefined, isLoading: false, error });
    mocks.resolve.mockReturnValue({ data: undefined, isLoading: false });
    const { result } = renderHook(() => useKubernetesResources({
      connectionID: 'selected-cluster', resourceType: 'k8s:/pods',
    }));
    expect(result.current.error).toBe(error);
    expect(mocks.resources).toHaveBeenCalledWith(expect.objectContaining({
      request: undefined, enabled: false,
    }));
  });

  it('retries catalog failure before collection acquisition', () => {
    const refetch = vi.fn();
    mocks.types.mockReturnValue({ data: undefined, isLoading: false, error: new Error('Catalog unavailable'), refetch });
    mocks.resolve.mockReturnValue({ data: undefined, isLoading: false });
    const { result } = renderHook(() => useKubernetesResources({
      connectionID: 'selected-cluster', resourceType: 'k8s:/pods',
    }));
    act(() => result.current.retry());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('retries host target resolution failure', () => {
    const refetch = vi.fn();
    const error = new Error('Target unavailable');
    mocks.resolve.mockReturnValue({ data: undefined, isLoading: false, error, refetch });
    const { result } = renderHook(() => useKubernetesResources({
      connectionID: 'selected-cluster', resourceType: 'k8s:/pods',
    }));
    expect(result.current.error).toBe(error);
    act(() => result.current.retry());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not admit a request before catalog and host resolution', () => {
    mocks.types.mockReturnValue({ data: [], isLoading: false });
    mocks.resolve.mockReturnValue({ data: undefined, isLoading: false });
    renderHook(() => useKubernetesResources({ connectionID: '', resourceType: 'k8s:/pods' }));
    expect(mocks.resources).toHaveBeenCalledWith(expect.objectContaining({ request: undefined, enabled: false }));
  });

  it('returns every acquired record without exposing source-page navigation', () => {
    mocks.resources.mockReturnValue({ resources: { data: {
      records: [
        { key: 'first', record: { body: {} } },
        { key: 'second', record: { body: {} } },
      ],
    }, isLoading: false } });
    const { result } = renderHook(() => useKubernetesResources({ connectionID: 'selected', resourceType: 'k8s:/pods' }));
    expect(mocks.resources).toHaveBeenLastCalledWith(expect.objectContaining({ collection: true }));
    expect(result.current.records.map(({ key }) => key)).toEqual(['first', 'second']);
    expect(result.current).not.toHaveProperty('pagination');
    expect(result.current).not.toHaveProperty('pageControls');
    expect(result.current).not.toHaveProperty('sourcePage');
  });

  it('uses newly resolved host authority when membership changes', () => {
    const { rerender } = renderHook(() => useKubernetesResources({ connectionID: 'selected', resourceType: 'k8s:/pods' }));
    mocks.resolve.mockReturnValue({ data: { targetId: 'new-membership', target: { authority: 'new-authority' } }, isLoading: false });
    rerender();
    expect(mocks.resources).toHaveBeenLastCalledWith(expect.objectContaining({
      request: { targetId: 'new-membership', request: { target: { authority: 'new-authority' }, pageSize: 200 } },
      collection: true,
    }));
  });

  it('exposes collection loading, errors, and explicit retry', () => {
    const refetch = vi.fn();
    const error = new Error('Collection unavailable');
    mocks.resources.mockReturnValue({
      resources: { data: undefined, isLoading: true, error, refetch },
    });
    const { result } = renderHook(() => useKubernetesResources({ connectionID: 'selected', resourceType: 'k8s:/pods' }));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBe(error);
    expect(refetch).not.toHaveBeenCalled();
    act(() => result.current.retry());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('decodes only replaced records when a live update retains the others', () => {
    const rec = (key: string) => ({ key, record: { body: { kind: 'map', value: key } } });
    mocks.decode.mockImplementation((body: { value: string }) => ({ name: body.value }));
    const [a, b, c] = [rec('a'), rec('b'), rec('c')];
    const page = (records: unknown[]) => mocks.resources.mockReturnValue({ resources: { data: { records }, isLoading: false } });
    page([a, b, c]);
    const { result, rerender } = renderHook(() => useKubernetesResources({ connectionID: 'selected', resourceType: 'k8s:/pods' }));
    const first = result.current.bodies;
    expect(mocks.decode).toHaveBeenCalledTimes(3);

    page([a, rec('b'), c]);
    rerender();
    expect(mocks.decode).toHaveBeenCalledTimes(4);
    expect(result.current.bodies[0]).toBe(first[0]);
    expect(result.current.bodies[1]).not.toBe(first[1]);
    expect(result.current.bodies[2]).toBe(first[2]);
  });
});
