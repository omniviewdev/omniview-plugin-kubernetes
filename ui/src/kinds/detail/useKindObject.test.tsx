import type { HostRecord } from '@omniviewdev/runtime/ui/v1';
import * as runtime from '@omniviewdev/runtime/ui/v1';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KindDetail } from '../definition';
import { hostRecord } from '../testing';

import { useKindObject, type KindObjectView } from './useKindObject';

// `useKindObject` is the read of the page of one object, for every kind (the Pod page's `usePod`, which it generalises): the plugin's catalog declares `name` as a query dimension of every native kind, so the
// resolved target narrows the read to that one object, and the source view holds that record and no other. What is under test is the arguments of the read chain for a kind that lives in a namespace
// and for one that does not, which record it picks, and what it says when the object is not there.
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

const DEPLOYMENTS = {
  type: 'k8s:apps/deployments',
  detail: { page: 'deployment', identity: ['namespace', 'name'] } satisfies KindDetail,
} as const;
const NODES = {
  type: 'k8s:/nodes',
  detail: { page: 'node', identity: ['name'] } satisfies KindDetail,
} as const;

const namespaced = (namespace: string, name: string) => [
  { dimension: 'namespace', match: 'oneOf', values: [namespace] },
  { dimension: 'name', match: 'oneOf', values: [name] },
];
const clusterScoped = (name: string) => [{ dimension: 'name', match: 'oneOf', values: [name] }];

const target = (type: string, scope: unknown) => ({
  route: { connection: 'kind-a' },
  provider: 'kubernetes',
  authority: 'local:a',
  type,
  scope,
  representation: 'kubernetes.object.v1/v1',
});

const deployment = (name: string, namespace = 'checkout') =>
  hostRecord(
    { metadata: { name, namespace }, spec: { replicas: 3 } },
    `row:${namespace}/${name}`,
    DEPLOYMENTS.type,
  );
const node = (name: string) => {
  const record = hostRecord({ metadata: { name } }, `row:${name}`, NODES.type);
  // A record of a kind that lives in no namespace has no namespace in its address.
  return {
    ...record,
    record: {
      ...record.record,
      reference: {
        ...record.record.reference,
        address: { ...record.record.reference.address, scope: [] },
      },
    },
  } as HostRecord;
};

const connect = vi.fn(async () => undefined);
const retryConnection = vi.fn(async () => undefined);
const refetchCollection = vi.fn(async () => undefined);
const refetchCatalog = vi.fn(async () => undefined);
const refetchTarget = vi.fn(async () => undefined);

type Answer = {
  readonly phase?: string;
  readonly message?: string;
  readonly types?: ReadonlyArray<{
    readonly type: string;
    readonly operations?: readonly string[];
  }>;
  readonly catalogError?: unknown;
  readonly target?: { readonly type: string; readonly scope: unknown } | false;
  readonly targetError?: unknown;
  /** The collection: records once its snapshot is complete. */
  readonly collection?: readonly HostRecord[];
  readonly collectionError?: unknown;
  readonly source?: Record<string, unknown>;
  readonly fetching?: boolean;
  readonly live?: boolean;
  readonly syncing?: boolean;
  /** Whether this source still occupies the current request, rather than a retained previous acquisition. */
  readonly current?: boolean;
};

const BOTH = [
  { type: DEPLOYMENTS.type, operations: ['enumerate', 'sourceUpdates'] },
  { type: NODES.type, operations: ['enumerate', 'sourceUpdates'] },
];

function answer({
  phase = 'connected',
  message,
  types = BOTH,
  catalogError = null,
  target: ready,
  targetError = null,
  collection,
  collectionError = null,
  source,
  fetching = false,
  live = false,
  syncing = false,
  current = true,
}: Answer = {}) {
  readiness.mockReturnValue({ phase, message, connect, retry: retryConnection } as never);
  resourceTypes.mockReturnValue({
    resourceTypes: {
      data:
        catalogError === null
          ? types.map(({ type, operations = [] }) => ({
              type,
              capabilities: operations.map((operation) => ({ operation, scope: [] })),
            }))
          : undefined,
      error: catalogError,
      refetch: refetchCatalog,
    },
  } as never);
  resolvedTarget.mockReturnValue({
    data:
      ready === false
        ? undefined
        : {
            targetId: 'target-1',
            target: target(
              ready?.type ?? DEPLOYMENTS.type,
              ready?.scope ?? namespaced('checkout', 'cart-api'),
            ),
          },
    error: targetError,
    refetch: refetchTarget,
  } as never);
  resources.mockReturnValue({
    resources: {
      data: collection ? { records: collection } : undefined,
      error: collectionError,
      isFetching: fetching,
      refetch: refetchCollection,
    },
    source,
    isLive: live,
    isAcquiredRequestCurrent: current,
    isSyncing: syncing,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

type Props = {
  readonly kind?: typeof DEPLOYMENTS | typeof NODES;
  readonly namespace?: string | undefined;
  readonly name?: string;
  readonly connectionID?: string | undefined;
};

const render = (props: Props = {}) =>
  renderHook<KindObjectView, Props>(
    (current) =>
      useKindObject(current.kind ?? DEPLOYMENTS, {
        connectionID: 'connectionID' in current ? current.connectionID : 'kind-a',
        namespace: 'namespace' in current ? current.namespace : 'checkout',
        name: current.name ?? 'cart-api',
      }),
    { initialProps: props },
  );

// An error as the Wails transport and the host deliver it: the host's complete error envelope (what `parseAppError` reads).
const envelope = (
  status: number,
  type: string,
  detail = 'The operation could not be completed.',
) => ({ type, title: 'x', status, detail });
const FORBIDDEN = envelope(403, 'omniview:resource/forbidden', 'no access');
const UNAVAILABLE = envelope(503, 'omniview:connection/failed', 'the cluster did not answer');
const BROKEN = envelope(500, 'omniview:internal', 'source down');

describe('the read chain: the catalog, the resolved target of the object, then its one-record source view, live', () => {
  it("for a kind that lives in a namespace: resolves the type narrowed to the object's namespace and name, and reads that collection live", () => {
    answer({ target: { type: DEPLOYMENTS.type, scope: namespaced('checkout', 'cart-api') } });

    render();

    expect(readiness).toHaveBeenCalledWith({
      pluginID: 'kubernetes',
      connectionID: 'kind-a',
      enabled: true,
    });
    expect(resourceTypes).toHaveBeenCalledWith({
      pluginID: 'kubernetes',
      route: { connection: 'kind-a' },
      enabled: true,
    });
    expect(resolvedTarget).toHaveBeenCalledWith({
      pluginID: 'kubernetes',
      route: { connection: 'kind-a' },
      type: DEPLOYMENTS.type,
      scope: namespaced('checkout', 'cart-api'),
      enabled: true,
    });
    expect(resources).toHaveBeenCalledWith({
      pluginID: 'kubernetes',
      request: {
        targetId: 'target-1',
        request: {
          target: target(DEPLOYMENTS.type, namespaced('checkout', 'cart-api')),
          pageSize: 256,
        },
      },
      collection: true,
      live: true,
    });
  });

  it('for a kind that lives in no namespace: resolves the type narrowed to the name alone, and puts no namespace in the scope (the catalog has no such dimension for it)', () => {
    answer({ target: { type: NODES.type, scope: clusterScoped('kind-control-plane') } });

    render({ kind: NODES, namespace: undefined, name: 'kind-control-plane' });

    expect(resolvedTarget).toHaveBeenCalledWith({
      pluginID: 'kubernetes',
      route: { connection: 'kind-a' },
      type: NODES.type,
      scope: clusterScoped('kind-control-plane'),
      enabled: true,
    });
  });

  it('ignores a namespace it is given for a kind that lives in none', () => {
    answer();

    render({ kind: NODES, namespace: 'checkout', name: 'kind-control-plane' });

    expect(resolvedTarget).toHaveBeenCalledWith(
      expect.objectContaining({ scope: clusterScoped('kind-control-plane') }),
    );
  });

  it('reads one collection, not two: there is no first explicit page beside it', () => {
    answer();

    render();

    expect(resources).toHaveBeenCalledTimes(1);
  });

  it('follows the source live only when the type advertises sourceUpdates', () => {
    answer({ types: [{ type: DEPLOYMENTS.type, operations: ['enumerate'] }] });

    render();

    expect(resources).toHaveBeenCalledWith(
      expect.objectContaining({ collection: true, live: false }),
    );
  });

  it('reads the other object when the route moves to it: the name, and the namespace, are part of what is read', () => {
    answer();
    const { rerender } = render({ namespace: 'checkout', name: 'cart-api' });

    rerender({ namespace: 'checkout', name: 'payment-gateway' });
    expect(resolvedTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: namespaced('checkout', 'payment-gateway') }),
    );
    rerender({ namespace: 'monitoring', name: 'alertmanager' });
    expect(resolvedTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: namespaced('monitoring', 'alertmanager') }),
    );
  });

  it("never asks for the namespace's other objects: no scope of the read leaves the name out", () => {
    answer();

    render({ namespace: 'bulk', name: 'bulk-0300' });

    for (const [options] of resolvedTarget.mock.calls) {
      expect(options.scope).toEqual(namespaced('bulk', 'bulk-0300'));
    }
  });

  it('does not resolve a target until the catalog lists the type, and reads nothing before the target answers', () => {
    answer({ types: [{ type: 'k8s:/pods', operations: ['enumerate'] }], target: false });

    render();

    expect(resolvedTarget).toHaveBeenCalledWith(
      expect.objectContaining({ type: DEPLOYMENTS.type, enabled: false }),
    );
    expect(resources).toHaveBeenCalledWith(expect.objectContaining({ request: undefined }));
  });

  it('reads through the plugin id it is given: the id the host installed the plugin under', () => {
    answer();

    renderHook(() =>
      useKindObject(DEPLOYMENTS, {
        pluginID: 'kubernetes-qa',
        connectionID: 'kind-a',
        namespace: 'checkout',
        name: 'cart-api',
      }),
    );

    for (const hook of [readiness, resourceTypes, resolvedTarget, resources]) {
      expect(hook).toHaveBeenCalledWith(expect.objectContaining({ pluginID: 'kubernetes-qa' }));
      expect(hook).not.toHaveBeenCalledWith(expect.objectContaining({ pluginID: 'kubernetes' }));
    }
  });

  it('reads nothing while there is no connection to read, or no identity to look for: no name, or no namespace for a kind that lives in one', () => {
    answer({ phase: 'checking', types: [], target: false });

    render({ connectionID: undefined });
    expect(readiness).toHaveBeenLastCalledWith({
      pluginID: 'kubernetes',
      connectionID: '',
      enabled: false,
    });
    expect(resourceTypes).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    cleanup();

    render({ name: '' });
    expect(readiness).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    cleanup();

    render({ namespace: '' });
    expect(readiness).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    cleanup();

    render({ namespace: undefined });
    expect(readiness).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('reads a kind that lives in no namespace without one, and nothing without a name', () => {
    answer();
    render({ kind: NODES, namespace: undefined, name: 'kind-control-plane' });
    expect(readiness).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    cleanup();

    render({ kind: NODES, namespace: undefined, name: '' });
    expect(readiness).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });
});

describe('the original record that may establish a placement or resource operation', () => {
  it('requires an active following source at its exact native target, not just a displayable object', () => {
    const wanted = deployment('cart-api');
    wanted.route.connection = 'kind-a';
    wanted.record.reference.address.authority = 'local:a';
    const baseline: Answer = { collection: [wanted], live: true };
    answer(baseline);
    const mounted = render();
    expect(mounted.result.current.currentRecord).toBe(wanted);
    for (const changed of [
      { current: false },
      { live: false },
      { fetching: true },
      { syncing: true },
      { collectionError: FORBIDDEN },
      { source: { state: 'failed', error: BROKEN } },
      { phase: 'forbidden' },
      { target: false },
      { target: { type: 'k8s:/services', scope: namespaced('checkout', 'cart-api') } },
    ] satisfies Answer[]) {
      answer({ ...baseline, ...changed });
      mounted.rerender({});
      expect(mounted.result.current.currentRecord).toBeUndefined();
    }
    for (const change of [
      (r: HostRecord) => {
        r.targetId = 'retired';
      },
      (r: HostRecord) => {
        r.route.connection = 'kind-b';
      },
      (r: HostRecord) => {
        r.record.reference.address.authority = 'local:b';
      },
      (r: HostRecord) => {
        r.record.reference.address.provider = 'foreign';
      },
      (r: HostRecord) => {
        r.record.reference.address.type = 'k8s:/services';
      },
    ]) {
      const other = structuredClone(wanted);
      change(other);
      answer({ ...baseline, collection: [other] });
      mounted.rerender({});
      expect(mounted.result.current.record).toBe(other);
      expect(mounted.result.current.currentRecord).toBeUndefined();
    }
  });
});

describe('which record is the object: the one whose address says so, whatever else a view holds', () => {
  it('picks the record of that name in that namespace from the complete snapshot', () => {
    const wanted = deployment('cart-api');
    answer({ collection: [deployment('payment-gateway'), wanted] });

    const { result } = render();

    expect(result.current.record).toBe(wanted);
    expect(result.current.state).toEqual({ kind: 'loaded' });
  });

  it('does not take an object of the same name in another namespace for it', () => {
    answer({ collection: [deployment('cart-api', 'staging')] });

    const { result } = render();

    expect(result.current.record).toBeUndefined();
    expect(result.current.state).toEqual({ kind: 'empty' });
  });

  it('picks a kind that lives in no namespace by its name alone', () => {
    const wanted = node('kind-control-plane');
    answer({
      collection: [node('other'), wanted],
      target: { type: NODES.type, scope: clusterScoped('kind-control-plane') },
    });

    const { result } = render({ kind: NODES, namespace: undefined, name: 'kind-control-plane' });

    expect(result.current.record).toBe(wanted);
  });

  it('hands over the same record object while the view holds it, so a page that reads again decodes nothing again', () => {
    const record = deployment('cart-api');
    answer({ collection: [record] });
    const { result, rerender } = render();
    const first = result.current.record;

    answer({ collection: [record, deployment('payment-gateway')] });
    rerender({});

    expect(result.current.record).toBe(first);
  });
});

describe('when the object is not there', () => {
  it("says empty, which is not found, when the object's own snapshot is complete and has no such object", () => {
    answer({ collection: [deployment('payment-gateway')] });

    const { result } = render();

    expect(result.current.state).toEqual({ kind: 'empty' });
    // The page never had it: it is not found, and not deleted.
    expect(result.current.deleted).toBe(false);
  });

  it('says loading while the collection has no complete snapshot: an object that is not in it yet is not missing', () => {
    answer({ collection: undefined });

    const { result } = render();

    expect(result.current.state).toEqual({ kind: 'loading' });
    expect(result.current.record).toBeUndefined();
  });

  it('follows an object deleted while its page is open: the snapshot that has it, then the one that has not', () => {
    answer({ collection: [deployment('cart-api'), deployment('payment-gateway')], live: true });
    const { result, rerender } = render();
    expect(result.current.state).toEqual({ kind: 'loaded' });
    expect(result.current.live).toBe(true);
    expect(result.current.deleted).toBe(false);

    answer({ collection: [deployment('payment-gateway')], live: true });
    rerender({});

    expect(result.current.record).toBeUndefined();
    expect(result.current.state).toEqual({ kind: 'empty' });
    // The page had the object and its source has since said it is gone: it was deleted.
    expect(result.current.deleted).toBe(true);
  });

  it('finds the object again when it is created again', () => {
    answer({ collection: [] });
    const { result, rerender } = render();
    expect(result.current.state).toEqual({ kind: 'empty' });

    answer({ collection: [deployment('cart-api')] });
    rerender({});

    expect(result.current.record).toBeDefined();
    expect(result.current.deleted).toBe(false);
  });

  it('does not say another object was deleted when the route moves to one the page never had, though it showed this one', () => {
    answer({ collection: [deployment('cart-api')] });
    const { result, rerender } = render();
    expect(result.current.record).toBeDefined();

    answer({
      collection: [deployment('cart-api')],
      target: { type: DEPLOYMENTS.type, scope: namespaced('checkout', 'other') },
    });
    rerender({ name: 'other' });

    expect(result.current.state).toEqual({ kind: 'empty' });
    expect(result.current.deleted).toBe(false);
  });

  it('does not say an object was deleted that this visit never showed: the route moves from an object it had to one that is absent, and back to the first while it is still absent', () => {
    answer({ collection: [deployment('cart-api')] });
    const { result, rerender } = render();
    expect(result.current.record).toBeDefined();

    answer({
      collection: [],
      target: { type: DEPLOYMENTS.type, scope: namespaced('checkout', 'other') },
    });
    rerender({ name: 'other' });
    expect(result.current.state).toEqual({ kind: 'empty' });
    expect(result.current.deleted).toBe(false);

    answer({ collection: [] });
    rerender({ name: 'cart-api' });
    expect(result.current.state).toEqual({ kind: 'empty' });
    expect(result.current.deleted).toBe(false);
  });

  it('says it for an object that lives in no namespace too', () => {
    const props = { kind: NODES, name: 'kind-control-plane', namespace: undefined };
    answer({
      collection: [node('kind-control-plane')],
      target: { type: NODES.type, scope: clusterScoped('kind-control-plane') },
    });
    const { result, rerender } = render(props);
    expect(result.current.record).toBeDefined();
    expect(result.current.deleted).toBe(false);

    answer({
      collection: [],
      target: { type: NODES.type, scope: clusterScoped('kind-control-plane') },
    });
    rerender(props);

    expect(result.current.state).toEqual({ kind: 'empty' });
    expect(result.current.deleted).toBe(true);
  });

  it("does not say deleted while the connection is down or the read is on its way again: only the object's own complete snapshot says it is gone", () => {
    answer({ collection: [deployment('cart-api')] });
    const { result, rerender } = render();
    expect(result.current.record).toBeDefined();

    answer({ phase: 'disconnected', collection: undefined });
    rerender({});

    expect(result.current.state.kind).toBe('disconnected');
    expect(result.current.deleted).toBe(false);
  });
});

describe('the connection and the read, as the lists word them', () => {
  it('maps each phase of the connection to its state, and reads no object before it is connected', () => {
    for (const [phase, kind] of [
      ['checking', 'connecting'],
      ['connecting', 'connecting'],
      ['disconnected', 'disconnected'],
      ['unauthorized', 'needs-sign-in'],
      ['forbidden', 'denied'],
      ['not-found', 'not-found'],
      ['error', 'unreachable'],
    ] as const) {
      answer({ phase, message: 'words', collection: [deployment('cart-api')] });
      const { result } = render();
      expect(result.current.state.kind, phase).toBe(kind);
      expect(result.current.record, phase).toBeUndefined();
      cleanup();
    }
  });

  it('says the cluster does not serve the kind when the catalog has no such type', () => {
    answer({ types: [{ type: 'k8s:/pods' }], target: false });

    expect(render().result.current.state).toEqual({ kind: 'unsupported' });
  });

  it('files a refusal of the read as denied when there is no object, and keeps the object beside it when there is one', () => {
    answer({ collectionError: FORBIDDEN });
    expect(render().result.current.state).toEqual({ kind: 'denied', message: 'no access' });
    cleanup();

    answer({ collection: [deployment('cart-api')], collectionError: FORBIDDEN });
    const { result } = render();
    expect(result.current.state).toEqual({ kind: 'loaded' });
    expect(result.current.failure).toEqual({ kind: 'denied', message: 'no access' });
    expect(result.current.record).toBeDefined();
  });

  it('keeps the object beside a failure that came after it, and says it', () => {
    answer({ collection: [deployment('cart-api')], collectionError: UNAVAILABLE });

    const { result } = render();

    expect(result.current.state).toEqual({ kind: 'loaded' });
    expect(result.current.failure).toEqual({
      kind: 'unreachable',
      message: 'the cluster did not answer',
    });
  });

  it('says a source that failed after it opened', () => {
    answer({ collection: [deployment('cart-api')], source: { state: 'failed', error: BROKEN } });

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
    answer({ collection: [deployment('cart-api')] });
    refetchCollection.mockRejectedValueOnce(new Error('boom'));

    const { result } = render();

    await expect(result.current.refresh()).resolves.toBeUndefined();
    expect(refetchCollection).toHaveBeenCalledTimes(1);
  });

  it('is refreshing only on an object that is shown: a running fetch or a resynchronisation of the complete snapshot', () => {
    answer({ collection: [deployment('cart-api')], fetching: true });
    expect(render().result.current.refreshing).toBe(true);
    cleanup();

    answer({ collection: [deployment('cart-api')], syncing: true });
    expect(render().result.current.refreshing).toBe(true);
    cleanup();

    answer({ collection: undefined, fetching: true });
    expect(render().result.current.refreshing).toBe(false);
    cleanup();

    answer({ collection: [deployment('cart-api')] });
    expect(render().result.current.refreshing).toBe(false);
  });
});
