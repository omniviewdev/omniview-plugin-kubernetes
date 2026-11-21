import * as runtime from '@omniviewdev/runtime/ui/v1';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextV1 } from '../contract/v1';

import { deploymentDefinition } from './deployments/definition';
import { listPage } from './list';
import { nodeDefinition } from './nodes/definition';
import { podDefinition } from './pods/definition';
import type { PodRow } from './pods/row';
import { replicaSetDefinition } from './replicasets/definition';
import * as kindRows from './useKindRows';

const podsPage = listPage(podDefinition);
const usePodsPage = podsPage.usePage;
type PodsView = kindRows.KindView<PodRow>;

// The data layer is its own seam, tested in ./useKindRows.test.tsx: here the hook (`useKindRows`, called `usePods` below) answers a view, and the runtime answers the list of connections. What is under
// test is what the page hands the host: which connection it reads, what it puts in the frame, what the page lists and in what state, and the one
// connection it starts.
vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  return { ...actual, useConnections: vi.fn() };
});
vi.mock('./useKindRows', async (importActual) => {
  const actual = await importActual<typeof kindRows>();
  return { ...actual, useKindRows: vi.fn() };
});

const connections = vi.mocked(runtime.useConnections);
const usePods = vi.mocked(kindRows.useKindRows);
const connect = vi.fn(async () => undefined);

function view(over: Partial<PodsView> = {}): PodsView {
  return {
    state: { kind: 'loaded' },
    failure: undefined,
    rows: [],
    loaded: 0,
    complete: true,
    count: { kind: 'exact', value: '0' },
    live: true,
    refreshing: false,
    connect,
    retry: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    ...over,
  };
}

/** A connection as the host lists it: the exact context name for its name, the kubeconfig it came from, and an id (the name unless the plugin derived one). */
const record = (name: string, id: string = name, kubeconfig = '~/.kube/config') => ({ id, name, labels: { kubeconfig }, data: { context: name } });

const know = (...names: readonly string[]) => {
  connections.mockReturnValue({ connections: { data: names.map((name) => record(name)), isPending: false } } as never);
};

/** The id the plugin derives for a connection: the context's name and ten hex digits, so that no id is a name. */
const idOf = (name: string) => `${name}-54c660ecd1`;

/** The connections of a plugin whose ids are derived: the page must say their names, and read them by their ids. */
const knowDerived = (...names: readonly string[]) => {
  connections.mockReturnValue({ connections: { data: names.map((name) => record(name, idOf(name))), isPending: false } } as never);
};

/** What the host tells the page: the plugin it is installed under, and the route (the connection the hash names, if it names one). */
const context = (connection: string | undefined = undefined, plugin = 'kubernetes'): ContextV1 => ({ plugin, route: { page: 'pods', connection } });

/** The page as the host runs it: one render of the hook, and the way to render it again for another route. */
const mount = (connection: string | undefined = undefined, plugin = 'kubernetes') =>
  renderHook((props: ContextV1) => usePodsPage(props), { initialProps: context(connection, plugin) });

beforeEach(() => {
  usePods.mockReturnValue(view());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('usePodsPage: which connection it reads', () => {
  it('reads the connection the route names, when the plugin knows it', () => {
    know('kind-a', 'kind-b');
    mount('kind-b');
    expect(usePods).toHaveBeenCalledWith(podDefinition, { pluginID: 'kubernetes', connectionID: 'kind-b' });
  });

  it('reads the first connection when the route names none, or one the plugin does not know', () => {
    know('kind-a', 'kind-b');
    mount();
    expect(usePods).toHaveBeenLastCalledWith(podDefinition, { pluginID: 'kubernetes', connectionID: 'kind-a' });
    cleanup();
    mount('kind-gone');
    expect(usePods).toHaveBeenLastCalledWith(podDefinition, { pluginID: 'kubernetes', connectionID: 'kind-a' });
  });

  it('reads the plugin it is installed under: the id the host tells it', () => {
    know('kind-a');
    mount('kind-a', 'kubernetes-qa');
    expect(connections).toHaveBeenCalledWith({ plugin: 'kubernetes-qa' });
    expect(usePods).toHaveBeenCalledWith(podDefinition, { pluginID: 'kubernetes-qa', connectionID: 'kind-a' });
  });

  it('reads nothing while there is no connection to read, and says it is loading while the list of connections is on its way', () => {
    connections.mockReturnValue({ connections: { data: undefined, isPending: true } } as never);
    const { result } = mount();
    expect(usePods).toHaveBeenLastCalledWith(podDefinition, { pluginID: 'kubernetes', connectionID: undefined });
    expect(result.current.source.state).toEqual({ kind: 'loading' });
    expect(result.current.source.rows).toEqual([]);
  });

  it('says "No connections", with nothing to retry, when the plugin has none (or is not installed)', () => {
    connections.mockReturnValue({ connections: { data: [], isPending: false } } as never);
    const { result } = mount();
    expect(usePods).toHaveBeenLastCalledWith(podDefinition, { pluginID: 'kubernetes', connectionID: undefined });
    expect(result.current.source.state).toEqual({ kind: 'failed', message: 'No connections' });
    expect(result.current.source.complete).toBe(false);
  });

  it('reads another connection when the route changes to it', () => {
    know('kind-a', 'kind-b');
    const { rerender } = mount('kind-a');
    expect(usePods).toHaveBeenLastCalledWith(podDefinition, { pluginID: 'kubernetes', connectionID: 'kind-a' });
    rerender(context('kind-b'));
    expect(usePods).toHaveBeenLastCalledWith(podDefinition, { pluginID: 'kubernetes', connectionID: 'kind-b' });
  });
});

describe('usePodsPage: what it hands the host', () => {
  it('puts itself in the frame as the Pods of the connection the route names, with the connection and the namespaces in the scope lane', () => {
    know('kind-a');
    const { frame } = mount('kind-a').result.current;
    expect(frame).toEqual({
      tab: { title: 'Pods', icon: 'box' },
      path: ['Kubernetes', 'kind-a', 'Pods'],
      scope: [
        { label: 'Connection', icon: 'server', text: 'kind-a' },
        { label: 'Namespaces', icon: 'folder-tree', text: 'All namespaces' },
      ],
    });
  });

  it('declares the scope lane and the connection in the path when the route names none: the connection the page picked, the plugin\'s first', () => {
    know('kind-a', 'kind-b');
    const { frame } = mount().result.current;
    expect(frame.path).toEqual(['Kubernetes', 'kind-a', 'Pods']);
    expect(frame.scope).toEqual([
      { label: 'Connection', icon: 'server', text: 'kind-a' },
      { label: 'Namespaces', icon: 'folder-tree', text: 'All namespaces' },
    ]);
  });

  it('shows the connection it reads, not the one the route names, when the plugin does not know that one', () => {
    know('kind-a');
    const { frame } = mount('kind-gone').result.current;
    expect(frame.scope?.[0]).toEqual({ label: 'Connection', icon: 'server', text: 'kind-a' });
    expect(frame.path).toEqual(['Kubernetes', 'kind-a', 'Pods']);
  });
});

// A connection has an id (`<name>-<10 hex>`: the page reads by it and a tab is found by it) and a name (the exact context name, or what the user renamed it to). A person reads the name: the frame never
// prints an id, and two connections of one name are told apart by the kubeconfig they came from.
describe('usePodsPage: the frame says the name of the connection, and the reads use its id', () => {
  it('says the name in the lane and in the path, and reads and keys by the id, whether the route names the connection or not', () => {
    knowDerived('kind-a', 'kind-b');
    for (const route of [idOf('kind-b'), undefined]) {
      const picked = route === undefined ? 'kind-a' : 'kind-b';
      const { frame } = mount(route).result.current;
      expect(frame.path).toEqual(['Kubernetes', picked, 'Pods']);
      expect(frame.scope?.[0]).toEqual({ label: 'Connection', icon: 'server', text: picked });
      expect(JSON.stringify(frame)).not.toContain('54c660ecd1');
      expect(usePods).toHaveBeenLastCalledWith(podDefinition, { pluginID: 'kubernetes', connectionID: idOf(picked) });
      cleanup();
    }
  });

  it('reads the first connection, and names it, for a route that holds an old id (before ids were derived the id was the context name) or the id of a connection that is gone', () => {
    knowDerived('kind-a', 'kind-b');
    for (const stale of ['kind-b', idOf('kind-gone')]) {
      const { frame } = mount(stale).result.current;
      expect(frame.scope?.[0]).toEqual({ label: 'Connection', icon: 'server', text: 'kind-a' });
      expect(frame.path).toEqual(['Kubernetes', 'kind-a', 'Pods']);
      expect(JSON.stringify(frame)).not.toContain(stale);
      expect(usePods).toHaveBeenLastCalledWith(podDefinition, { pluginID: 'kubernetes', connectionID: idOf('kind-a') });
      cleanup();
    }
  });

  it('tells two connections of one name apart by their kubeconfig, and keeps their ids apart', () => {
    connections.mockReturnValue({
      connections: { data: [record('prod', 'prod-1111111111', '~/.kube/config'), record('prod', 'prod-2222222222', '~/work/other')], isPending: false },
    } as never);
    const [first, second] = [mount('prod-1111111111'), mount('prod-2222222222')].map(({ result }) => result.current.frame);
    expect(first?.scope?.[0]?.text).toBe('prod \u00B7 config');
    expect(second?.scope?.[0]?.text).toBe('prod \u00B7 other');
    expect(first?.path).toEqual(['Kubernetes', 'prod \u00B7 config', 'Pods']);
    expect(usePods).toHaveBeenCalledWith(podDefinition, { pluginID: 'kubernetes', connectionID: 'prod-1111111111' });
    expect(usePods).toHaveBeenCalledWith(podDefinition, { pluginID: 'kubernetes', connectionID: 'prod-2222222222' });
  });
});

// The host reserves the scope lane while a plugin loads and gives it back when the page's first frame has none, so a frame with no scope moves the page by the lane's 40 px
// (docs/ui-next/status/S1b.md): the lane is declared from the first render, whatever the page does not know yet.
describe('usePodsPage: the scope lane is there from the first render', () => {
  const lane = (frame: { readonly scope?: ReadonlyArray<{ readonly label: string; readonly text: string }> | undefined }) => frame.scope?.map((face) => `${face.label}: ${face.text}`);

  it('has both faces while the list of connections is on its way and the route names none, with a word for the connection that is not known yet', () => {
    connections.mockReturnValue({ connections: { data: undefined, isPending: true } } as never);
    const { frame } = mount().result.current;
    expect(lane(frame)).toEqual(['Connection: Loading…', 'Namespaces: All namespaces']);
    expect(frame.path).toEqual(['Kubernetes', 'Pods']);
  });

  it('names no connection while the list of connections is on its way, even when the route names one: a route holds an id, and an id is never printed', () => {
    connections.mockReturnValue({ connections: { data: undefined, isPending: true } } as never);
    const { frame } = mount(idOf('kind-b')).result.current;
    expect(lane(frame)).toEqual(['Connection: Loading…', 'Namespaces: All namespaces']);
    expect(frame.path).toEqual(['Kubernetes', 'Pods']);
  });

  it('has both faces when the plugin has no connection, which it says', () => {
    connections.mockReturnValue({ connections: { data: [], isPending: false } } as never);
    expect(lane(mount().result.current.frame)).toEqual(['Connection: None', 'Namespaces: All namespaces']);
  });

  it('has the same two faces, in the same order, in every one of those states: the page never gains or loses the lane', () => {
    const states = [
      () => connections.mockReturnValue({ connections: { data: undefined, isPending: true } } as never),
      () => know('kind-a'),
      () => connections.mockReturnValue({ connections: { data: [], isPending: false } } as never),
    ];
    for (const setUp of states) {
      setUp();
      expect(mount().result.current.frame.scope?.map((face) => face.label)).toEqual(['Connection', 'Namespaces']);
      cleanup();
    }
  });
});

describe('usePodsPage: what else it hands the host', () => {
  it('hands over the rows and the state of what usePods read', () => {
    know('kind-a');
    const rows = [{ key: 'k1', name: 'cart-api-1', namespace: 'checkout' }] as unknown as PodsView['rows'];
    usePods.mockReturnValue(view({ rows, loaded: 1, complete: false, state: { kind: 'loaded' } }));
    const { source } = mount('kind-a').result.current;
    expect(source.rows).toBe(rows);
    expect(source.complete).toBe(false);
    expect(source.state).toEqual({ kind: 'ready' });
  });
});

describe('podsPage: what it contributes', () => {
  it('is a list page: the Pods list: its title and nouns, the quick filters of the definition, and the columns of its default set', () => {
    expect(podsPage.kind).toBe('list');
    const { definition } = podsPage;
    expect(definition.title).toBe('Pods');
    expect(definition.nouns).toEqual({ one: 'Pod', other: 'Pods' });
    expect(definition.lines).toBe(2);
    expect(definition.quickFilters.label).toBe('Pod state');
    expect(definition.quickFilters.filters.map((filter) => filter.label)).toEqual(['Running', 'Pending', 'Failed', 'Completed']);
    expect(definition.columns.map((column) => column.header)).toEqual(['Name', 'Ready', 'Status', 'Restarts', 'Age']);
  });
});

describe('usePodsPage: the connection it starts (a development shortcut: a read never connects, plan D4)', () => {
  it('starts a connection it finds stopped, once', () => {
    know('kind-a');
    usePods.mockReturnValue(view({ state: { kind: 'disconnected' } }));
    const { rerender } = mount('kind-a');
    expect(connect).toHaveBeenCalledTimes(1);
    rerender(context('kind-a'));
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('starts nothing for a connection that is up, connecting, or failed', () => {
    know('kind-a');
    for (const state of [{ kind: 'loaded' }, { kind: 'connecting' }, { kind: 'unreachable' }] as const) {
      usePods.mockReturnValue(view({ state }));
      mount('kind-a');
      cleanup();
    }

    expect(connect).not.toHaveBeenCalled();
  });
});

describe('the same page for another kind: the definition is the only thing that differs', () => {
  const deploymentsPage = listPage(deploymentDefinition);
  const mountDeployments = (connection: string | undefined = undefined) =>
    renderHook((props: ContextV1) => deploymentsPage.usePage(props), { initialProps: { plugin: 'kubernetes', route: { page: 'deployments', connection, params: {} } } as ContextV1 });

  it('reads the kind it is given, through the connection the route names', () => {
    know('kind-a', 'kind-b');
    mountDeployments('kind-b');
    expect(usePods).toHaveBeenCalledWith(deploymentDefinition, { pluginID: 'kubernetes', connectionID: 'kind-b' });
  });

  it('puts itself in the frame as the kind\'s plural, with the kind\'s glyph, and the same two faces in the lane', () => {
    know('kind-a');
    const { frame } = mountDeployments('kind-a').result.current;
    expect(frame).toEqual({
      tab: { title: 'Deployments', icon: deploymentDefinition.tile.icon },
      path: ['Kubernetes', 'kind-a', 'Deployments'],
      scope: [
        { label: 'Connection', icon: 'server', text: 'kind-a' },
        { label: 'Namespaces', icon: 'folder-tree', text: 'All namespaces' },
      ],
    });
  });

  it('is a list page with its own words, quick filters and default columns', () => {
    const { definition } = deploymentsPage;
    expect(deploymentsPage.kind).toBe('list');
    expect(definition.title).toBe('Deployments');
    expect(definition.nouns).toEqual({ one: 'Deployment', other: 'Deployments' });
    expect(definition.quickFilters.label).toBe('Deployment state');
    expect(definition.quickFilters.filters.map((filter) => filter.label)).toEqual(['Available', 'Progressing', 'Partially ready', 'Unavailable']);
    expect(definition.columns.map((column) => column.header)).toEqual(['Name', 'Status', 'Ready', 'Up-to-date', 'Age']);
  });

  it('says in the kind\'s own words that the connection is not there: "No connections", with nothing to retry', () => {
    connections.mockReturnValue({ connections: { data: [], isPending: false } } as never);
    const { result } = mountDeployments();
    expect(result.current.source.state).toEqual({ kind: 'failed', message: 'No connections' });
  });
});

// A kind whose mock definition has no state field has no strip of quick filters, and a kind that lives in no namespace is read through the same chain: the page asks the data layer for the
// kind and the connection, and no namespace comes into it.
describe('a kind with no quick filters, and a kind of the cluster', () => {
  const nodesPage = listPage(nodeDefinition);
  const mountNodes = () =>
    renderHook((props: ContextV1) => nodesPage.usePage(props), { initialProps: { plugin: 'kubernetes', route: { page: 'nodes', connection: 'kind-a', params: {} } } as ContextV1 });

  it('hands the host no strip for a kind that has none: a strip with only All would be a control that filters nothing', () => {
    const { definition } = listPage(replicaSetDefinition);
    expect(definition.title).toBe('ReplicaSets');
    expect(definition).not.toHaveProperty('quickFilters');
  });

  it('hands the host the strip of a kind that has one, under the kind\'s name for its states', () => {
    const { definition } = nodesPage;
    expect(definition.quickFilters?.label).toBe('Node state');
    expect(definition.quickFilters?.filters.map((filter) => filter.label)).toEqual(['Ready', 'NotReady', 'Scheduling disabled']);
  });

  it('reads a Node through the connection the route names, as it reads every kind: the kind and the connection, and no namespace', () => {
    know('kind-a');
    mountNodes();
    expect(usePods).toHaveBeenCalledWith(nodeDefinition, { pluginID: 'kubernetes', connectionID: 'kind-a' });
  });

  it('puts a Node page in the frame as the kind\'s plural with the kind\'s tile glyph', () => {
    know('kind-a');
    const { frame } = mountNodes().result.current;
    expect(frame.tab).toEqual({ title: 'Nodes', icon: nodeDefinition.tile.icon });
    expect(frame.path).toEqual(['Kubernetes', 'kind-a', 'Nodes']);
  });
});
