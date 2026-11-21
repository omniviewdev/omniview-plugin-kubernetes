import * as runtime from '@omniviewdev/runtime/ui/v1';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextV1, DetailPageViewV1, PanelHostV1 } from '../contract/v1';
import { hostRecord } from '../kinds/testing';

import { podDetail } from './data/object';
import * as read from './data/usePod';
import { podLogTargetId } from './logs/target';
import { detailState, usePodPage } from './usePodPage';

import { podPage, podPageDefinition } from './index';

// The read is its own seam, tested in ./data: here `usePod` answers a view, and the runtime answers the list of connections. What is under test is what the page hands the host: which
// Pod it reads and in which connection, the lane it declares, the state of the page and the view it keeps beside a failure, the one connection it starts, and the Logs command it gives the header.
vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  return { ...actual, useConnections: vi.fn(), openLogStream: vi.fn() };
});
vi.mock('./data/usePod', () => ({ usePod: vi.fn() }));

const connections = vi.mocked(runtime.useConnections);
const openLogStream = vi.mocked(runtime.openLogStream);
const usePod = vi.mocked(read.usePod);
const connect = vi.fn(async () => undefined);
const retry = vi.fn(async () => undefined);
const refresh = vi.fn(async () => undefined);

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const object = { metadata: { name: 'cart-api', namespace: 'checkout', creationTimestamp: new Date(NOW - 8 * 60_000).toISOString() }, spec: { nodeName: 'node-1', containers: [{ name: 'app', image: 'busybox:1' }] }, status: { phase: 'Running' } };
/** The id the plugin derives for a connection: the context's name and ten hex digits, so no id is a name. */
function idOf(name: string): string {
  return `${name}-54c660ecd1`;
}

const RECORD = { ...hostRecord(object), route: { connection: idOf('kind-a') } };
const POD = podDetail(RECORD);

function view(over: Partial<read.PodView> = {}): read.PodView {
  return { state: { kind: 'loaded' }, failure: undefined, pod: POD, record: RECORD, deleted: false, live: true, refreshing: false, connect, retry, refresh, ...over };
}

/** The plugin knows these connections: each has a derived id, the context name for its name, and the kubeconfig it came from. */
const know = (...names: readonly string[]) => {
  const data = names.map((name) => ({ id: idOf(name), name, labels: { kubeconfig: '~/.kube/config' }, data: { context: name } }));
  connections.mockReturnValue({ connections: { data, isPending: false } } as never);
};

/** What the host tells the page: the plugin it is installed under, the route (the connection the hash names, and the Pod's identity) and, on a host that has it, the panel handle. */
const context = (over: { readonly connection?: string; readonly params?: Record<string, string>; readonly plugin?: string; readonly panel?: PanelHostV1 } = {}): ContextV1 => ({
  plugin: over.plugin ?? 'kubernetes',
  route: { page: 'pod', connection: over.connection, params: over.params ?? { namespace: 'checkout', name: 'cart-api' } },
  ...(over.panel === undefined ? {} : { panel: over.panel }),
});

const mount = (over: Parameters<typeof context>[0] = {}) => renderHook((props: ContextV1) => usePodPage(props), { initialProps: context(over) });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  know('kind-a');
  usePod.mockReturnValue(view());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('usePodPage: which Pod it reads, and where', () => {
  it('reads the Pod the route names, in the connection the route names when the plugin knows it', () => {
    know('kind-a', 'kind-b');
    mount({ connection: idOf('kind-b'), params: { namespace: 'monitoring', name: 'alertmanager' } });
    expect(usePod).toHaveBeenCalledWith({ pluginID: 'kubernetes', connectionID: idOf('kind-b'), namespace: 'monitoring', name: 'alertmanager' });
  });

  it('reads the plugin\'s first connection when the route names none, or one the plugin does not know: the plugin owns what an absent connection means', () => {
    know('kind-a', 'kind-b');
    mount();
    expect(usePod).toHaveBeenLastCalledWith(expect.objectContaining({ connectionID: idOf('kind-a') }));
    cleanup();
    mount({ connection: 'kind-gone' });
    expect(usePod).toHaveBeenLastCalledWith(expect.objectContaining({ connectionID: idOf('kind-a') }));
  });

  it('reads the plugin it is installed under: the id the host tells it', () => {
    mount({ plugin: 'kubernetes-qa' });
    expect(connections).toHaveBeenCalledWith({ plugin: 'kubernetes-qa' });
    expect(usePod).toHaveBeenCalledWith(expect.objectContaining({ pluginID: 'kubernetes-qa' }));
  });

  it('reads nothing while the list of connections is on its way, or when the plugin has none', () => {
    connections.mockReturnValue({ connections: { data: undefined, isPending: true } } as never);
    mount();
    expect(usePod).toHaveBeenLastCalledWith(expect.objectContaining({ connectionID: undefined }));
    cleanup();
    connections.mockReturnValue({ connections: { data: [], isPending: false } } as never);
    mount();
    expect(usePod).toHaveBeenLastCalledWith(expect.objectContaining({ connectionID: undefined }));
  });

  it('reads another Pod when the route changes to it', () => {
    const { rerender } = mount();
    rerender(context({ params: { namespace: 'checkout', name: 'payment-gateway' } }));
    expect(usePod).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'payment-gateway' }));
  });
});

describe('usePodPage: the scope lane is there from the first render', () => {
  const lane = (scope: DetailPageViewV1['scope']) => scope?.map((face) => `${face.label}: ${face.text}`);

  it('has the connection and the namespace of the Pod', () => {
    expect(lane(mount({ connection: idOf('kind-a') }).result.current.scope)).toEqual(['Connection: kind-a', 'Namespaces: checkout']);
  });

  it('has the connection the page reads when the route names none, and a word for it while the connections are on their way, and when there are none', () => {
    know('kind-a', 'kind-b');
    expect(lane(mount().result.current.scope)).toEqual(['Connection: kind-a', 'Namespaces: checkout']);
    cleanup();
    connections.mockReturnValue({ connections: { data: undefined, isPending: true } } as never);
    expect(lane(mount().result.current.scope)).toEqual(['Connection: Loading…', 'Namespaces: checkout']);
    cleanup();
    connections.mockReturnValue({ connections: { data: [], isPending: false } } as never);
    expect(lane(mount().result.current.scope)).toEqual(['Connection: None', 'Namespaces: checkout']);
  });

  it('names the connection by its name and never by its id, for a route that holds an id, a stale one, or one the connections have not answered for yet', () => {
    know('kind-a', 'kind-b');
    expect(lane(mount({ connection: idOf('kind-b') }).result.current.scope)).toEqual(['Connection: kind-b', 'Namespaces: checkout']);
    cleanup();
    expect(lane(mount({ connection: 'kind-b' }).result.current.scope)).toEqual(['Connection: kind-a', 'Namespaces: checkout']);
    cleanup();
    connections.mockReturnValue({ connections: { data: undefined, isPending: true } } as never);
    const { result } = mount({ connection: idOf('kind-b') });
    expect(lane(result.current.scope)).toEqual(['Connection: Loading…', 'Namespaces: checkout']);
    expect(JSON.stringify(result.current.scope)).not.toContain('54c660ecd1');
  });

  it('has the same two faces whatever state the page is in: a page never gains or loses its lane', () => {
    for (const state of [{ kind: 'loading' }, { kind: 'loaded' }, { kind: 'empty' }, { kind: 'failed' }, { kind: 'denied' }] as const) {
      usePod.mockReturnValue(view({ state, pod: state.kind === 'loaded' ? POD : undefined }));
      expect(mount().result.current.scope?.map((face) => face.label), state.kind).toEqual(['Connection', 'Namespaces']);
      cleanup();
    }
  });

  it('says the namespace is unknown when the route has none, and does not read a Pod for it', () => {
    const { result } = mount({ params: { name: 'cart-api' } });
    expect(lane(result.current.scope)).toEqual(['Connection: kind-a', 'Namespaces: Unknown']);
    expect(result.current.source.state.kind).toBe('not-found');
    expect(result.current.source.view).toBeUndefined();
  });
});

describe('usePodPage: the state of the page', () => {
  const stateOf = (over: Partial<read.PodView>) => {
    usePod.mockReturnValue(view(over));
    const { result } = mount();
    return result.current.source;
  };

  it('is ready, with the view of the Pod, when the Pod is there', () => {
    const source = stateOf({});
    expect(source.state).toEqual({ kind: 'ready' });
    expect(source.view?.state).toEqual({ role: 'running', label: 'Running' });
    expect(source.refreshing).toBe(false);
  });

  it('is loading, with no view, while the connection is checked, started or stopped, or the namespace is read: a stopped connection is a wait, the page starts it', () => {
    for (const kind of ['connecting', 'disconnected', 'loading'] as const) {
      const source = stateOf({ state: { kind }, pod: undefined });
      expect(source.state, kind).toEqual({ kind: 'loading' });
      expect(source.view, kind).toBeUndefined();
    }
  });

  it('says the Pod is not found, with its namespace, when the namespace was read whole, it is not in it and the page never had it, and gives no title: the page\'s own, "<name> was not found", is the true one', () => {
    const source = stateOf({ state: { kind: 'empty' }, pod: undefined });
    expect(source.state).toEqual({ kind: 'not-found', message: 'Pod cart-api doesn\'t exist in namespace checkout. It may have been deleted.' });
    expect(source.state).not.toHaveProperty('title');
    expect(source.view).toBeUndefined();
  });

  it('says the Pod was deleted when the page had it and its source has since said it is gone: the title says "<name> was deleted" and the message where it no longer exists, as the mock does, and nothing that says the opposite', () => {
    const { state } = stateOf({ state: { kind: 'empty' }, pod: undefined, deleted: true });
    expect(state).toEqual({ kind: 'not-found', title: 'cart-api was deleted', message: 'It no longer exists in namespace checkout.' });
    expect(JSON.stringify(state)).not.toContain('not found');
  });

  it('says access is denied in its own words: the runtime\'s text for a denial is the host\'s fixed sentence, which says nothing', () => {
    for (const message of ['The operation could not be completed.', 'pods is forbidden', undefined]) {
      expect(stateOf({ state: { kind: 'denied', message }, pod: undefined }).state).toEqual({ kind: 'denied', message: 'You do not have access to read this Pod.' });
    }
  });

  it('says a failure with a Retry when asking again can help, and without one when it cannot', () => {
    // The runtime sends its fixed generic text for a classified cause (and a connection's raw detail for a connection that failed): the page says the cause itself.
    for (const [kind, message] of [
      ['needs-sign-in', 'The connection needs you to sign in.'],
      ['unreachable', 'The cluster did not answer.'],
      ['failed', 'The Pod could not be read.'],
    ] as const) {
      const { state } = stateOf({ state: { kind }, pod: undefined });
      expect(state).toMatchObject({ kind: 'failed', message });
      if (state.kind === 'failed') {
        state.retry?.();
      }
    }

    expect(retry).toHaveBeenCalledTimes(3);
    expect(stateOf({ state: { kind: 'unsupported' }, pod: undefined }).state).toEqual({ kind: 'failed', message: 'This cluster does not serve Pods.' });
    expect(stateOf({ state: { kind: 'not-found' }, pod: undefined }).state).toEqual({ kind: 'failed', message: 'This connection no longer exists.' });
  });

  it('does not show the runtime\'s text for a cause the data layer classified: it is fixed and generic, or the raw detail of a connection', () => {
    expect(stateOf({ state: { kind: 'unreachable', message: 'resource operation failed' }, pod: undefined }).state).toMatchObject({ kind: 'failed', message: 'The cluster did not answer.' });
    expect(stateOf({ state: { kind: 'needs-sign-in', message: 'dial tcp 10.0.0.1:443: i/o timeout' }, pod: undefined }).state).toMatchObject({ kind: 'failed', message: 'The connection needs you to sign in.' });
  });

  it('says a failure the data layer could not classify in the runtime\'s words when it sent some', () => {
    expect(stateOf({ state: { kind: 'failed', message: 'the source stream broke' }, pod: undefined }).state).toMatchObject({ kind: 'failed', message: 'the source stream broke' });
  });

  it('keeps the view of the Pod beside a failure that came after it, and says the cause', () => {
    const source = stateOf({ state: { kind: 'loaded' }, failure: { kind: 'unreachable', message: 'the cluster stopped answering' } });
    expect(source.state).toMatchObject({ kind: 'failed', message: 'The cluster did not answer.' });
    expect(source.view).toBeDefined();
    const unclassified = stateOf({ state: { kind: 'loaded' }, failure: { kind: 'failed', message: 'the watch broke' } });
    expect(unclassified.state).toMatchObject({ kind: 'failed', message: 'the watch broke' });
  });

  it('keeps no view for a failure that left no Pod to show', () => {
    expect(stateOf({ state: { kind: 'failed' }, pod: undefined }).view).toBeUndefined();
  });

  it('hands over the read\'s refresh and whether one is running', () => {
    const source = stateOf({ refreshing: true });
    expect(source.refreshing).toBe(true);
    void source.refresh();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('follows a Pod deleted while the page is open: the view, then the not-found state, with the lane unchanged', () => {
    const { result, rerender } = mount();
    expect(result.current.source.state).toEqual({ kind: 'ready' });
    usePod.mockReturnValue(view({ state: { kind: 'empty' }, pod: undefined, deleted: true }));
    rerender(context());
    expect(result.current.source.state).toMatchObject({ kind: 'not-found', title: 'cart-api was deleted' });
    expect(result.current.scope?.map((face) => face.text)).toEqual(['kind-a', 'checkout']);
  });
});

describe('detailState: the Pods data layer\'s words for the connection and the read, in the detail page\'s', () => {
  it('has a state for every state of the read: none is left to fall through', () => {
    const kinds = ['connecting', 'disconnected', 'needs-sign-in', 'denied', 'unreachable', 'not-found', 'failed', 'unsupported', 'loading', 'empty', 'loaded'] as const;
    for (const kind of kinds) {
      expect(detailState(view({ state: { kind } }), 'checkout', 'cart-api').kind, kind).toMatch(/^(loading|ready|not-found|denied|failed)$/);
    }
  });
});

describe('usePodPage: the age of the Pod in the header, kept by the page\'s one clock', () => {
  it('says how long ago the Pod was created, in one unit', () => {
    const { result } = mount();
    expect(result.current.source.view?.facts).toEqual([{ text: 'checkout' }, { text: 'node-1' }, { text: '8m' }]);
  });
});

describe('usePodPage: the connection it starts (a development shortcut: a read never connects, plan D4)', () => {
  it('starts a connection it finds stopped, once', () => {
    usePod.mockReturnValue(view({ state: { kind: 'disconnected' }, pod: undefined }));
    const { rerender } = mount();
    expect(connect).toHaveBeenCalledTimes(1);
    rerender(context());
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('starts nothing for a connection that is up, connecting, or failed', () => {
    for (const state of [{ kind: 'loaded' }, { kind: 'connecting' }, { kind: 'unreachable' }] as const) {
      usePod.mockReturnValue(view({ state }));
      mount();
      cleanup();
    }

    expect(connect).not.toHaveBeenCalled();
  });
});

describe('usePodPage: the Logs command of the header (P1b-3b)', () => {
  const started = { ...object, status: { phase: 'Running', containerStatuses: [{ name: 'app', state: { running: { startedAt: new Date(NOW - 60_000).toISOString() } } }] } };
  const startedRecord = { ...hostRecord(started), route: { connection: idOf('kind-a') } };
  const stream = { id: 'stream-1' } as unknown as runtime.LogStream;

  /** A panel handle that records what it is asked, and the one command of the header the page gives for Logs. */
  function pressed(over: Parameters<typeof context>[0] = {}) {
    const open = vi.fn<PanelHostV1['logs']['open']>(() => ({ id: 'session-1', close: vi.fn() }));
    const mounted = mount({ panel: { logs: { open } }, ...over });
    const command = mounted.result.current.source.view?.commands?.primary;
    return { open, command, mounted };
  }

  beforeEach(() => {
    usePod.mockReturnValue(view({ pod: podDetail(startedRecord), record: startedRecord }));
    openLogStream.mockReturnValue(stream);
  });

  it('opens a session in the Logs tool through the host\'s panel handle for the Pod the page shows, named by the connection the page reads and keyed by its id', () => {
    const { open, command } = pressed();
    expect(command).toMatchObject({ id: 'logs', label: 'Logs' });
    expect(command?.disabledReason).toBeUndefined();
    command?.onSelect();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        id: podLogTargetId(idOf('kind-a'), 'checkout', 'cart-api'),
        title: 'cart-api',
        scope: 'kind-a',
        resource: { label: 'Pod cart-api', kind: 'Pod', icon: 'box', route: { page: 'pod', connection: undefined, params: { namespace: 'checkout', name: 'cart-api' } } },
      }),
    );
    const handed = open.mock.calls[0]?.[0];
    expect(handed?.id).toBe('pod/kind-a-54c660ecd1/checkout/cart-api');
    expect(handed?.scope).not.toContain('54c660ecd1');
  });

  it('names the connection as the scope lane does: the one the page reads, when the route names none', () => {
    know('kind-a', 'kind-b');
    const { open, command } = pressed();
    command?.onSelect();
    expect(open.mock.calls[0]?.[0].scope).toBe('kind-a');
    expect(open.mock.calls[0]?.[0].scope).toBe(mount().result.current.scope?.[0]?.text);
  });

  it('hands the Logs session the name of the connection the route asks for, and two connections of one name stay two targets by their ids', () => {
    know('kind-a', 'kind-b');
    const second = { ...hostRecord(started), route: { connection: idOf('kind-b') } };
    usePod.mockReturnValue(view({ pod: podDetail(second), record: second }));
    const { open, command } = pressed({ connection: idOf('kind-b') });
    command?.onSelect();
    expect(open.mock.calls[0]?.[0].scope).toBe('kind-b');
    expect(open.mock.calls[0]?.[0].id).toBe(podLogTargetId(idOf('kind-b'), 'checkout', 'cart-api'));

    const twin = [
      { id: 'prod-aaaaaaaaaa', name: 'prod', labels: { kubeconfig: '~/.kube/config' }, data: { context: 'prod' } },
      { id: 'prod-bbbbbbbbbb', name: 'prod', labels: { kubeconfig: '~/work/other' }, data: { context: 'prod' } },
    ];
    connections.mockReturnValue({ connections: { data: twin, isPending: false } } as never);
    const targets = ['prod-aaaaaaaaaa', 'prod-bbbbbbbbbb'].map((id) => {
      const record = { ...hostRecord(started), route: { connection: id } };
      usePod.mockReturnValue(view({ pod: podDetail(record), record }));
      const twinOpen = pressed({ connection: id });
      twinOpen.command?.onSelect();
      cleanup();
      return twinOpen.open.mock.calls[0]?.[0];
    });
    expect(targets.map((target) => target?.scope)).toEqual(['prod · config', 'prod · other']);
    expect(new Set(targets.map((target) => target?.id)).size).toBe(2);
  });

  it('opens the stream of the Pod\'s own record when the host asks for it, through the plugin it is installed under', () => {
    const { open, command } = pressed({ plugin: 'kubernetes-qa' });
    command?.onSelect();
    expect(openLogStream).not.toHaveBeenCalled();
    const feed = open.mock.calls[0]?.[0].open();
    expect(feed).toBe(stream);
    expect(openLogStream).toHaveBeenCalledWith(
      expect.objectContaining({ plugin: 'kubernetes-qa', connection: idOf('kind-a'), resourceKey: 'k8s:/pods', resourceId: 'cart-api', resourceData: startedRecord.record.body, reference: startedRecord.record.reference, route: startedRecord.route, target: '' }),
    );
  });

  it('says this host cannot show logs when the host gave the page no panel handle', () => {
    const command = mount().result.current.source.view?.commands?.primary;
    expect(command?.disabledReason).toBe('This version of Omniview cannot show logs here.');
  });

  it('says no container has started for a Pod that has none, the Pods\' own words for a Pod that was never run', () => {
    usePod.mockReturnValue(view());
    const { open, command } = pressed();
    expect(command?.disabledReason).toBe('No container of this Pod has started, so it has no logs yet.');
    command?.onSelect();
    expect(open).not.toHaveBeenCalled();
  });

  it('gives the Pod\'s Logs command a reason that follows the Pod: the Pod that starts a container is the next render\'s enabled command', () => {
    usePod.mockReturnValue(view());
    const open = vi.fn<PanelHostV1['logs']['open']>(() => undefined);
    const { result, rerender } = mount({ panel: { logs: { open } } });
    expect(result.current.source.view?.commands?.primary?.disabledReason).toBe('No container of this Pod has started, so it has no logs yet.');
    usePod.mockReturnValue(view({ pod: podDetail(startedRecord), record: startedRecord }));
    rerender(context({ panel: { logs: { open } } }));
    expect(result.current.source.view?.commands?.primary?.disabledReason).toBeUndefined();
  });

  it('says no more about Logs in the line it prints for the commands that cannot be used: the other two are the ones left', () => {
    const { command, mounted } = pressed();
    expect(command?.disabledReason).toBeUndefined();
    const { commands } = mounted.result.current.source.view ?? {};
    expect([commands?.secondary?.[0]?.disabledReason, commands?.danger?.disabledReason]).toEqual(['Shell and Delete are not available yet', 'Shell and Delete are not available yet']);
  });
});

describe('podPage: what it contributes', () => {
  it('is a detail page: the hook above, and a definition of a Pod named by its name and its namespace, read from the Pods list, with an Overview tab', () => {
    expect(podPage.kind).toBe('detail');
    expect(podPage.usePage).toBe(usePodPage);
    expect(podPage.definition).toBe(podPageDefinition);
    expect(podPageDefinition).toEqual({
      kind: 'Pod',
      tile: { icon: 'box', tone: 'blue' },
      identity: { name: 'name', facets: ['namespace'] },
      list: { page: 'pods', label: 'Pods' },
      tabs: [{ id: 'overview', label: 'Overview' }],
    });
  });

  it('has a view for every tab it declares: a tab of the definition that the view lacks would show nothing', () => {
    const { view: shown } = mount().result.current.source;
    expect(Object.keys(shown?.tabs ?? {})).toEqual(podPageDefinition.tabs.map((tab) => tab.id));
  });
});
