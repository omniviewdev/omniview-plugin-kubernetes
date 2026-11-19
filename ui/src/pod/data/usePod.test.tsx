import type { HostRecord } from '@omniviewdev/runtime/ui/v1';
import * as runtime from '@omniviewdev/runtime/ui/v1';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hostRecord } from '../../pods/data/testing';

import { usePod, type PodView } from './usePod';

// `usePod` is the INTERIM seam of the Pod page (see its file): the runtime's curated entry has no single-object read, so it reads the Pod's namespace as a live collection through the fenced
// hooks and picks the record by its address. What is under test is the arguments of the read chain, which record it picks, and what it says when the Pod is not there.
vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  return {
    ...actual,
    useConnectionReadiness: vi.fn(),
    useResourceTypes: vi.fn(),
    useResolvedResourceTarget: vi.fn(),
    useResources: vi.fn(),
  };
});

const readiness = vi.mocked(runtime.useConnectionReadiness);
const resourceTypes = vi.mocked(runtime.useResourceTypes);
const resolvedTarget = vi.mocked(runtime.useResolvedResourceTarget);
const resources = vi.mocked(runtime.useResources);

const namespaceScope = (namespace: string) => [{ dimension: 'namespace', match: 'oneOf', values: [namespace] }];
const target = { route: { connection: 'kind-a' }, provider: 'kubernetes', authority: 'local:a', type: 'k8s:/pods', scope: namespaceScope('checkout'), representation: 'kubernetes.object.v1/v1' };
const request = { targetId: 'target-checkout', request: { target, pageSize: 256 } };

const pod = (name: string, namespace = 'checkout', phase = 'Running') => hostRecord({ metadata: { name, namespace }, status: { phase } }, `row:${namespace}/${name}`);

const connect = vi.fn(async () => undefined);
const retryConnection = vi.fn(async () => undefined);
const refetchCollection = vi.fn(async () => undefined);
const refetchCatalog = vi.fn(async () => undefined);
const refetchTarget = vi.fn(async () => undefined);

type Answer = {
  readonly phase?: string;
  readonly message?: string;
  readonly types?: ReadonlyArray<{ readonly type: string; readonly operations?: readonly string[] }>;
  readonly catalogError?: unknown;
  readonly target?: boolean;
  readonly targetError?: unknown;
  /** The collection: records once its snapshot is complete. */
  readonly collection?: readonly HostRecord[];
  readonly collectionError?: unknown;
  readonly source?: Record<string, unknown>;
  readonly fetching?: boolean;
  readonly live?: boolean;
  readonly syncing?: boolean;
};

const podType = { type: 'k8s:/pods', operations: ['enumerate', 'sourceUpdates'] };

function answer({ phase = 'connected', message, types = [podType], catalogError = null, target: targetReady = true, targetError = null, collection, collectionError = null, source, fetching = false, live = false, syncing = false }: Answer = {}) {
  readiness.mockReturnValue({ phase, message, connect, retry: retryConnection } as never);
  resourceTypes.mockReturnValue({
    resourceTypes: {
      data: catalogError === null ? types.map(({ type, operations = [] }) => ({ type, capabilities: operations.map((operation) => ({ operation, scope: [] })) })) : undefined,
      error: catalogError,
      refetch: refetchCatalog,
    },
  } as never);
  resolvedTarget.mockReturnValue({ data: targetReady ? { targetId: 'target-checkout', target } : undefined, error: targetError, refetch: refetchTarget } as never);
  resources.mockReturnValue({
    resources: { data: collection ? { records: collection } : undefined, error: collectionError, isFetching: fetching, refetch: refetchCollection },
    source,
    isLive: live,
    isSyncing: syncing,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

/** `connectionID: undefined` is a page with no connection to read, which is not the same as one that did not say. */
type Props = { readonly namespace?: string; readonly name?: string; readonly connectionID?: string | undefined };

const render = (props: Props = {}) =>
  renderHook<PodView, Props>((current) => usePod({ connectionID: 'connectionID' in current ? current.connectionID : 'kind-a', namespace: current.namespace ?? 'checkout', name: current.name ?? 'cart-api' }), {
    initialProps: props,
  });

// An error as the Wails transport and the host deliver it: the host's complete error envelope (what `parseAppError` reads).
const envelope = (status: number, type: string, detail = 'The operation could not be completed.') => ({ type, title: 'x', status, detail });
const FORBIDDEN = envelope(403, 'omniview:resource/forbidden', 'no access');
const UNAVAILABLE = envelope(503, 'omniview:connection/failed', 'the cluster did not answer');
const BROKEN = envelope(500, 'omniview:internal', 'source down');

describe('the read chain: the catalog, the resolved target of the namespace, then the namespace as a live collection', () => {
  it('asks the catalog, resolves the Pod type in the Pod\'s namespace only, and reads that collection live', () => {
    answer();

    render();

    expect(readiness).toHaveBeenCalledWith({ pluginID: 'kubernetes', connectionID: 'kind-a', enabled: true });
    expect(resourceTypes).toHaveBeenCalledWith({ pluginID: 'kubernetes', route: { connection: 'kind-a' }, enabled: true });
    expect(resolvedTarget).toHaveBeenCalledWith({ pluginID: 'kubernetes', route: { connection: 'kind-a' }, type: 'k8s:/pods', scope: namespaceScope('checkout'), enabled: true });
    expect(resources).toHaveBeenCalledWith({ pluginID: 'kubernetes', request, collection: true, live: true });
  });

  it('reads one collection, not two: there is no first explicit page beside it', () => {
    answer();

    render();

    expect(resources).toHaveBeenCalledTimes(1);
  });

  it('follows the source live only when the Pod type advertises sourceUpdates', () => {
    answer({ types: [{ type: 'k8s:/pods', operations: ['enumerate'] }] });

    render();

    expect(resources).toHaveBeenCalledWith(expect.objectContaining({ collection: true, live: false }));
  });

  it('reads another namespace\'s collection when the route moves to a Pod of another namespace', () => {
    answer();
    const { rerender } = render({ namespace: 'checkout' });

    rerender({ namespace: 'monitoring', name: 'alertmanager' });

    expect(resolvedTarget).toHaveBeenLastCalledWith(expect.objectContaining({ scope: namespaceScope('monitoring') }));
  });

  it('does not resolve a target until the catalog lists the Pod type, and reads nothing before the target answers', () => {
    answer({ types: [{ type: 'k8s:apps/deployments', operations: ['enumerate'] }], target: false });

    render();

    expect(resolvedTarget).toHaveBeenCalledWith(expect.objectContaining({ type: 'k8s:/pods', enabled: false }));
    expect(resources).toHaveBeenCalledWith(expect.objectContaining({ request: undefined }));
  });

  it('reads through the plugin id it is given: the id the host installed the plugin under', () => {
    answer();

    renderHook(() => usePod({ pluginID: 'kubernetes-qa', connectionID: 'kind-a', namespace: 'checkout', name: 'cart-api' }));

    for (const hook of [readiness, resourceTypes, resolvedTarget, resources]) {
      expect(hook).toHaveBeenCalledWith(expect.objectContaining({ pluginID: 'kubernetes-qa' }));
      expect(hook).not.toHaveBeenCalledWith(expect.objectContaining({ pluginID: 'kubernetes' }));
    }
  });

  it('reads nothing while there is no connection to read, or no identity to look for', () => {
    answer({ phase: 'checking', types: [], target: false });

    render({ connectionID: undefined });
    expect(readiness).toHaveBeenLastCalledWith({ pluginID: 'kubernetes', connectionID: '', enabled: false });
    expect(resourceTypes).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    cleanup();

    render({ name: '' });
    expect(readiness).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    cleanup();

    render({ namespace: '' });
    expect(readiness).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });
});

describe('which record is the Pod: the one whose address says so', () => {
  it('picks the record of that name in that namespace from the complete snapshot, and reads it as a Pod', () => {
    answer({ collection: [pod('payment-gateway', 'checkout'), pod('cart-api', 'checkout', 'Pending')] });

    const { result } = render();

    expect(result.current.pod?.metadata.name).toBe('cart-api');
    expect(result.current.pod?.status.phase).toBe('Pending');
    expect(result.current.state).toEqual({ kind: 'loaded' });
  });

  it('does not take a Pod of the same name in another namespace for it', () => {
    answer({ collection: [pod('cart-api', 'staging')] });

    const { result } = render();

    expect(result.current.pod).toBeUndefined();
    expect(result.current.state).toEqual({ kind: 'empty' });
  });

  it('reads the same record object as the same Pod, so a live update decodes only the Pod that changed', () => {
    const record = pod('cart-api');
    answer({ collection: [record] });

    const { result, rerender } = render();
    const first = result.current.pod;
    answer({ collection: [record, pod('payment-gateway')] });
    rerender({});

    expect(result.current.pod).toBe(first);
  });
});

describe('when the Pod is not there', () => {
  it('says empty, which is not found, when the namespace was read whole and the Pod is not in it', () => {
    answer({ collection: [pod('payment-gateway')] });

    expect(render().result.current.state).toEqual({ kind: 'empty' });
  });

  it('says loading while the collection has no complete snapshot: a Pod that is not in it yet is not missing', () => {
    answer({ collection: undefined });

    const { result } = render();

    expect(result.current.state).toEqual({ kind: 'loading' });
    expect(result.current.pod).toBeUndefined();
  });

  it('follows a Pod deleted while its page is open: the snapshot that has it, then the one that has not', () => {
    answer({ collection: [pod('cart-api'), pod('payment-gateway')], live: true });
    const { result, rerender } = render();
    expect(result.current.state).toEqual({ kind: 'loaded' });
    expect(result.current.live).toBe(true);

    answer({ collection: [pod('payment-gateway')], live: true });
    rerender({});

    expect(result.current.pod).toBeUndefined();
    expect(result.current.state).toEqual({ kind: 'empty' });
  });

  it('finds the Pod again when it is created again', () => {
    answer({ collection: [] });
    const { result, rerender } = render();
    expect(result.current.state).toEqual({ kind: 'empty' });

    answer({ collection: [pod('cart-api', 'checkout', 'Pending')] });
    rerender({});

    expect(result.current.pod?.status.phase).toBe('Pending');
  });
});

describe('the connection and the read, as the Pods list words them', () => {
  it('maps each phase of the connection to its state, and reads no Pod before it is connected', () => {
    for (const [phase, kind] of [
      ['checking', 'connecting'],
      ['connecting', 'connecting'],
      ['disconnected', 'disconnected'],
      ['unauthorized', 'needs-sign-in'],
      ['forbidden', 'denied'],
      ['not-found', 'not-found'],
      ['error', 'unreachable'],
    ] as const) {
      answer({ phase, message: 'words', collection: [pod('cart-api')] });
      const { result } = render();
      expect(result.current.state.kind, phase).toBe(kind);
      expect(result.current.pod, phase).toBeUndefined();
      cleanup();
    }
  });

  it('says the cluster does not serve Pods when the catalog has no Pod type', () => {
    answer({ types: [{ type: 'k8s:apps/deployments' }], target: false });

    expect(render().result.current.state).toEqual({ kind: 'unsupported' });
  });

  it('files an error of the read as the state when there is no Pod, and keeps the Pod beside it when there is one', () => {
    answer({ collectionError: FORBIDDEN });
    expect(render().result.current.state).toEqual({ kind: 'denied', message: 'no access' });
    cleanup();

    answer({ collection: [pod('cart-api')], collectionError: UNAVAILABLE });
    const { result } = render();
    expect(result.current.state).toEqual({ kind: 'loaded' });
    expect(result.current.failure).toEqual({ kind: 'unreachable', message: 'the cluster did not answer' });
    expect(result.current.pod?.metadata.name).toBe('cart-api');
  });

  it('says a source that failed after it opened', () => {
    answer({ collection: [pod('cart-api')], source: { state: 'failed', error: BROKEN } });

    expect(render().result.current.failure).toEqual({ kind: 'failed', message: 'source down' });
  });
});

describe('what the page can ask of it', () => {
  it('starts the connection through the readiness it reads, and nothing reads it by itself', () => {
    answer({ phase: 'disconnected' });

    const { result } = render();
    void result.current.connect();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('retries what failed, from the first step down: the connection, the catalog, the target, then the collection', async () => {
    answer({ phase: 'error' });
    await render().result.current.retry();
    expect(retryConnection).toHaveBeenCalledTimes(1);
    cleanup();

    answer({ catalogError: BROKEN });
    await render().result.current.retry();
    expect(refetchCatalog).toHaveBeenCalledTimes(1);
    cleanup();

    answer({ targetError: BROKEN });
    await render().result.current.retry();
    expect(refetchTarget).toHaveBeenCalledTimes(1);
    cleanup();

    answer({ collectionError: BROKEN });
    await render().result.current.retry();
    expect(refetchCollection).toHaveBeenCalledTimes(1);
  });

  it('refreshes the collection, and never throws a failure into the caller: the failure is the state', async () => {
    answer({ collection: [pod('cart-api')] });
    refetchCollection.mockRejectedValueOnce(new Error('boom'));

    const { result } = render();

    await expect(result.current.refresh()).resolves.toBeUndefined();
    expect(refetchCollection).toHaveBeenCalledTimes(1);
  });

  it('is refreshing only on a Pod that is shown: a running fetch or a resynchronisation of the complete snapshot', () => {
    answer({ collection: [pod('cart-api')], fetching: true });
    expect(render().result.current.refreshing).toBe(true);
    cleanup();

    answer({ collection: [pod('cart-api')], syncing: true });
    expect(render().result.current.refreshing).toBe(true);
    cleanup();

    answer({ collection: undefined, fetching: true });
    expect(render().result.current.refreshing).toBe(false);
    cleanup();

    answer({ collection: [pod('cart-api')] });
    expect(render().result.current.refreshing).toBe(false);
  });
});
