import * as runtime from '@omniviewdev/runtime/ui/v1';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextV1, DetailPageViewV1 } from '../../contract/v1';
import type { KindDetail } from '../definition';
import { hostRecord } from '../testing';

import type { KindOverview } from './overview';
import { detailState, useKindDetailPage, type DetailedKind } from './useKindDetailPage';
import * as read from './useKindObject';

// The read is its own seam, tested in ./useKindObject: here `useKindObject` answers a view, and the runtime answers the list of connections. What is under test is what the page hands the host: which object it
// reads and in which connection, the lane it declares, the state of the page and the view it keeps beside a failure, and the one connection it starts.
vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  return { ...actual, useConnections: vi.fn() };
});
vi.mock('./useKindObject', () => ({ useKindObject: vi.fn() }));

const connections = vi.mocked(runtime.useConnections);
const useKindObject = vi.mocked(read.useKindObject);
const connect = vi.fn(async () => undefined);
const retry = vi.fn(async () => undefined);
const refresh = vi.fn(async () => undefined);

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const EMPTY: KindOverview = { state: { word: 'Available', role: 'healthy' }, createdAt: NOW - 6 * 86_400_000, summary: [{ text: 'up to date' }], details: [], conditions: [], labels: [], annotations: [] };

const kindOf = (kind: string, identity: KindDetail['identity']): DetailedKind => ({
  kind,
  type: `k8s:apps/${kind.toLowerCase()}s`,
  nouns: { one: kind, other: `${kind}s` },
  tile: { icon: 'rocket', tone: 'blue' },
  page: `${kind.toLowerCase()}s`,
  detail: { page: kind.toLowerCase(), identity, overview: () => EMPTY, commands: () => ({ danger: { id: 'delete', label: 'Delete' } }) },
}) as DetailedKind;

const DEPLOYMENT = kindOf('Deployment', ['namespace', 'name']);
const NODE = kindOf('Node', ['name']);

const RECORD = hostRecord({ metadata: { name: 'cart-api', namespace: 'checkout' } });
const idOf = (name: string) => `${name}-54c660ecd1`;
const know = (...names: readonly string[]) => {
  const data = names.map((name) => ({ id: idOf(name), name, labels: { kubeconfig: '~/.kube/config' }, data: { context: name } }));
  connections.mockReturnValue({ connections: { data, isPending: false } } as never);
};

function view(over: Partial<read.KindObjectView> = {}): read.KindObjectView {
  return { state: { kind: 'loaded' }, failure: undefined, record: RECORD, live: true, refreshing: false, connect, retry, refresh, ...over };
}

const resolve = () => undefined;

/** What the host tells the page: the plugin it is installed under and the route: the connection the hash names and the object's identity. */
const context = (over: { readonly connection?: string; readonly params?: Record<string, string>; readonly plugin?: string } = {}): ContextV1 => ({
  plugin: over.plugin ?? 'kubernetes',
  route: { page: 'deployment', connection: over.connection, params: over.params ?? { namespace: 'checkout', name: 'cart-api' } },
});

const mount = (over: Parameters<typeof context>[0] = {}, kind: DetailedKind = DEPLOYMENT) => renderHook((props: ContextV1) => useKindDetailPage(kind, props, resolve), { initialProps: context(over) });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  know('kind-a');
  useKindObject.mockReturnValue(view());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useKindDetailPage: which object it reads, and where', () => {
  it('reads the object the route names, in the connection the route names when the plugin knows it, through the kind\'s own type', () => {
    know('kind-a', 'kind-b');
    mount({ connection: idOf('kind-b'), params: { namespace: 'monitoring', name: 'alertmanager' } });
    expect(useKindObject).toHaveBeenCalledWith(DEPLOYMENT, { pluginID: 'kubernetes', connectionID: idOf('kind-b'), namespace: 'monitoring', name: 'alertmanager' });
  });

  it('reads an object of a kind that lives in no namespace by its name alone: no namespace is asked for', () => {
    mount({ params: { name: 'kind-control-plane' } }, NODE);
    expect(useKindObject).toHaveBeenCalledWith(NODE, { pluginID: 'kubernetes', connectionID: idOf('kind-a'), namespace: undefined, name: 'kind-control-plane' });
  });

  it('reads the plugin\'s first connection when the route names none, or one the plugin does not know: the plugin owns what an absent connection means', () => {
    know('kind-a', 'kind-b');
    mount();
    expect(useKindObject).toHaveBeenLastCalledWith(DEPLOYMENT, expect.objectContaining({ connectionID: idOf('kind-a') }));
    cleanup();
    mount({ connection: 'kind-gone' });
    expect(useKindObject).toHaveBeenLastCalledWith(DEPLOYMENT, expect.objectContaining({ connectionID: idOf('kind-a') }));
  });

  it('reads the plugin it is installed under: the id the host tells it', () => {
    mount({ plugin: 'kubernetes-qa' });
    expect(connections).toHaveBeenCalledWith({ plugin: 'kubernetes-qa' });
    expect(useKindObject).toHaveBeenCalledWith(DEPLOYMENT, expect.objectContaining({ pluginID: 'kubernetes-qa' }));
  });

  it('reads nothing while the list of connections is on their way, or when the plugin has none', () => {
    connections.mockReturnValue({ connections: { data: undefined, isPending: true } } as never);
    mount();
    expect(useKindObject).toHaveBeenLastCalledWith(DEPLOYMENT, expect.objectContaining({ connectionID: undefined }));
    cleanup();
    connections.mockReturnValue({ connections: { data: [], isPending: false } } as never);
    mount();
    expect(useKindObject).toHaveBeenLastCalledWith(DEPLOYMENT, expect.objectContaining({ connectionID: undefined }));
  });

  it('reads another object when the route changes to it', () => {
    const { rerender } = mount();
    rerender(context({ params: { namespace: 'checkout', name: 'payment-gateway' } }));
    expect(useKindObject).toHaveBeenLastCalledWith(DEPLOYMENT, expect.objectContaining({ name: 'payment-gateway' }));
  });
});

describe('useKindDetailPage: the scope lane is there from the first render', () => {
  const lane = (scope: DetailPageViewV1['scope']) => scope?.map((face) => `${face.label}: ${face.text}`);

  it('has the connection and the namespace of an object that lives in one', () => {
    expect(lane(mount({ connection: idOf('kind-a') }).result.current.scope)).toEqual(['Connection: kind-a', 'Namespaces: checkout']);
  });

  it('has the connection alone for an object that lives in no namespace: there is no namespace to say', () => {
    expect(lane(mount({ params: { name: 'kind-control-plane' } }, NODE).result.current.scope)).toEqual(['Connection: kind-a']);
  });

  it('has a word for the connection while the connections are on their way, and when there are none, and never the id', () => {
    connections.mockReturnValue({ connections: { data: undefined, isPending: true } } as never);
    const { result } = mount({ connection: idOf('kind-a') });
    expect(lane(result.current.scope)).toEqual(['Connection: Loading…', 'Namespaces: checkout']);
    expect(JSON.stringify(result.current.scope)).not.toContain('54c660ecd1');
    cleanup();
    connections.mockReturnValue({ connections: { data: [], isPending: false } } as never);
    expect(lane(mount().result.current.scope)).toEqual(['Connection: None', 'Namespaces: checkout']);
  });

  it('has the same faces whatever state the page is in: a page never gains or loses its lane', () => {
    const faces = (state: read.KindObjectView) => {
      useKindObject.mockReturnValue(state);
      const { result } = mount();
      const text = lane(result.current.scope);
      cleanup();
      return text;
    };
    const expected = ['Connection: kind-a', 'Namespaces: checkout'];
    expect(faces(view({ state: { kind: 'loading' }, record: undefined }))).toEqual(expected);
    expect(faces(view({ state: { kind: 'empty' }, record: undefined }))).toEqual(expected);
    expect(faces(view({ state: { kind: 'denied' }, record: undefined }))).toEqual(expected);
    expect(faces(view())).toEqual(expected);
  });
});

describe('useKindDetailPage: the connection it starts', () => {
  it('starts the one it finds stopped, once, and none that is not', () => {
    useKindObject.mockReturnValue(view({ state: { kind: 'disconnected' }, record: undefined }));
    mount();
    expect(connect).toHaveBeenCalledTimes(1);
    cleanup();
    connect.mockClear();

    useKindObject.mockReturnValue(view());
    mount();
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('detailState: the object\'s page, in the words of the object', () => {
  const words = { kind: 'Deployment', plural: 'Deployments', name: 'cart-api', namespace: 'checkout' };
  const state = (over: Partial<read.KindObjectView>, who = words) => detailState(view(over), who);

  it('is loading while the connection or the read is on its way, and a stopped connection is a wait too', () => {
    for (const kind of ['connecting', 'disconnected', 'loading'] as const) {
      expect(state({ state: { kind }, record: undefined })).toEqual({ kind: 'loading' });
    }
  });

  it('is ready when the object is there, and the page keeps it', () => {
    expect(state({})).toEqual({ kind: 'ready' });
  });

  it('is not found when the object\'s own complete snapshot has no such object: it never was, or it was deleted, also while its page was open', () => {
    expect(state({ state: { kind: 'empty' }, record: undefined })).toEqual({
      kind: 'not-found',
      message: 'Deployment cart-api doesn\'t exist in namespace checkout. It may have been deleted.',
    });
  });

  it('says this cluster, and not a namespace, for a kind that lives in no namespace', () => {
    expect(state({ state: { kind: 'empty' }, record: undefined }, { kind: 'Node', plural: 'Nodes', name: 'kind-control-plane', namespace: undefined })).toEqual({
      kind: 'not-found',
      message: 'Node kind-control-plane doesn\'t exist in this cluster. It may have been deleted.',
    });
  });

  it('is FORBIDDEN when the user may not read the object: the plugin\'s own sentence, whatever words the runtime sent, and no Retry', () => {
    const forbidden = state({ state: { kind: 'denied', message: 'the runtime\'s fixed sentence' }, record: undefined });
    expect(forbidden).toEqual({ kind: 'denied', message: 'You do not have permission to read Deployment cart-api in namespace checkout.' });
    expect(forbidden).not.toHaveProperty('retry');
    expect(JSON.stringify(forbidden)).not.toContain('fixed sentence');
  });

  it('says this cluster in the refusal for a kind that lives in no namespace', () => {
    expect(state({ state: { kind: 'denied' }, record: undefined }, { kind: 'Node', plural: 'Nodes', name: 'kind-control-plane', namespace: undefined })).toEqual({
      kind: 'denied',
      message: 'You do not have permission to read Node kind-control-plane in this cluster.',
    });
  });

  it('keeps the object beside a refusal that came after it, and offers no Retry: asking again cannot change a refusal', () => {
    const after = state({ failure: { kind: 'denied', message: 'no' } });
    expect(after).toEqual({ kind: 'failed', message: 'You do not have permission to read Deployment cart-api in namespace checkout.' });
    expect(after).not.toHaveProperty('retry');
  });

  it('says the cause itself for a failure the data layer classified, and offers a Retry that asks the read again', () => {
    for (const [kind, message] of [
      ['needs-sign-in', 'The connection needs you to sign in.'],
      ['unreachable', 'The cluster did not answer.'],
    ] as const) {
      const failed = state({ state: { kind, message: 'raw detail' }, record: undefined });
      expect(failed).toEqual({ kind: 'failed', message, retry: expect.any(Function) });
      if (failed.kind === 'failed') {
        failed.retry?.();
      }
    }

    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('uses the runtime\'s words only for a failure it could not classify', () => {
    expect(state({ state: { kind: 'failed', message: 'source down' }, record: undefined })).toEqual({ kind: 'failed', message: 'source down', retry: expect.any(Function) });
    expect(state({ state: { kind: 'failed' }, record: undefined })).toEqual({ kind: 'failed', message: 'The Deployment could not be read.', retry: expect.any(Function) });
  });

  it('offers no Retry where asking again cannot help: a cluster that does not serve the kind, and a connection that is gone', () => {
    expect(state({ state: { kind: 'unsupported' }, record: undefined })).toEqual({ kind: 'failed', message: 'This cluster does not serve Deployments.' });
    expect(state({ state: { kind: 'not-found' }, record: undefined })).toEqual({ kind: 'failed', message: 'This connection no longer exists.' });
  });

  it('keeps the object beside a failure that came after it', () => {
    const after = state({ failure: { kind: 'unreachable', message: 'raw' } });
    expect(after).toEqual({ kind: 'failed', message: 'The cluster did not answer.', retry: expect.any(Function) });
  });
});

describe('useKindDetailPage: what it hands the host', () => {
  it('is the object, drawn, once it is there: the state, the facts of the identity line with the age the clock keeps, and the commands the kind lays out', () => {
    const { source } = mount().result.current;
    expect(source.state).toEqual({ kind: 'ready' });
    expect(source.view?.state).toEqual({ role: 'healthy', label: 'Available' });
    expect(source.view?.facts).toEqual([{ text: 'Deployment' }, { text: 'checkout' }, { text: '6d' }]);
    expect(source.view?.commands?.danger).toMatchObject({ id: 'delete', disabledReason: 'Delete is not available yet' });
  });

  it('says no namespace in the identity line of an object that lives in none', () => {
    const { source } = mount({ params: { name: 'kind-control-plane' } }, NODE).result.current;
    expect(source.view?.facts).toEqual([{ text: 'Node' }, { text: '6d' }]);
  });

  it('keeps the object on screen while it is refreshed, and after a failure that follows it: a failure does not take away what was shown', () => {
    useKindObject.mockReturnValue(view({ failure: { kind: 'unreachable', message: 'raw' }, refreshing: true }));
    const { source } = mount().result.current;
    expect(source.state.kind).toBe('failed');
    expect(source.view).toBeDefined();
    expect(source.refreshing).toBe(true);
  });

  it('draws no object while it has none: loading, not found, refused', () => {
    for (const state of [{ kind: 'loading' }, { kind: 'empty' }, { kind: 'denied' }] as const) {
      useKindObject.mockReturnValue(view({ state, record: undefined }));
      expect(mount().result.current.source.view, state.kind).toBeUndefined();
      cleanup();
    }
  });

  it('is not found, and reads nothing, for a route that names no object: no name, or no namespace for a kind that lives in one', () => {
    useKindObject.mockReturnValue(view({ state: { kind: 'loading' }, record: undefined }));
    expect(mount({ params: { namespace: 'checkout' } }).result.current.source.state).toMatchObject({ kind: 'not-found' });
    cleanup();
    expect(mount({ params: { name: 'cart-api' } }).result.current.source.state).toMatchObject({ kind: 'not-found' });
    cleanup();
    expect(mount({ params: {} }, NODE).result.current.source.state).toMatchObject({ kind: 'not-found' });
  });

  it('hands the host the object\'s own Refresh', async () => {
    const { source } = mount().result.current;
    await source.refresh();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
