import * as runtime from '@omniviewdev/runtime/ui/v1';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextV1 } from '../contract/v1';
import { getOpenCounts, openKey, resetOpenCounts } from '../sidebar/openCounts';

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
    namespaced: true,
    connect,
    retry: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    ...over,
  };
}

const know = (...ids: readonly string[]) => {
  connections.mockReturnValue({ connections: { data: ids.map((id) => ({ id })), isPending: false } } as never);
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
  resetOpenCounts();
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

  it('names the connection the route asks for while the list of connections is on its way', () => {
    connections.mockReturnValue({ connections: { data: undefined, isPending: true } } as never);
    expect(lane(mount('kind-b').result.current.frame)).toEqual(['Connection: kind-b', 'Namespaces: All namespaces']);
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

// A list that is open says how many it lists, to the sidebar (Q2): the sidebar draws that number for the kind and reads no page of one for it. What it says is what the list knows, from the very source it
// reads: the number of its rows once the whole set is here, the count its first page says it holds before that. It says it for as long as the page is open.
describe('usePodsPage: the count it says to the sidebar', () => {
  const pods = openKey('kubernetes', 'kind-a', 'k8s:/pods');
  const someRows = (count: number) => Array.from({ length: count }, (_, index) => ({ key: `k${String(index)}` })) as unknown as PodsView['rows'];

  it('says the number of its rows when the whole set is here', () => {
    know('kind-a');
    usePods.mockReturnValue(view({ rows: someRows(3), loaded: 3, complete: true }));

    mount('kind-a');

    expect(getOpenCounts().get(pods)).toBe(3);
  });

  it('says zero for a whole set that is empty: that is a count, and the one a person wants to see', () => {
    know('kind-a');
    usePods.mockReturnValue(view({ rows: [], complete: true, state: { kind: 'empty' } }));

    mount('kind-a');

    expect(getOpenCounts().get(pods)).toBe(0);
  });

  it.each<[string, PodsView['firstCount'], unknown]>([
    ['an exact count', { kind: 'exact', value: '40' }, 40],
    ['an estimate', { kind: 'estimate', value: '5025' }, { value: 5025, approximate: true }],
    ['an unknown count', { kind: 'unknown' }, null],
    ['no count: the first page has not arrived', undefined, null],
  ])('says what the first page says it holds while the set is not complete: %s', (_name, firstCount, expected) => {
    know('kind-a');
    usePods.mockReturnValue(view({ rows: someRows(256), loaded: 256, complete: false, firstCount }));

    mount('kind-a');

    expect(getOpenCounts().get(pods)).toEqual(expected);
    expect(getOpenCounts().has(pods)).toBe(true);
  });

  it('does not say the number of the rows it has loaded while the set is not complete: a first page is not how many objects there are', () => {
    know('kind-a');
    usePods.mockReturnValue(view({ rows: someRows(256), loaded: 256, complete: false, firstCount: { kind: 'unknown' } }));

    mount('kind-a');

    expect(getOpenCounts().get(pods)).toBeNull();
  });

  it('follows the list: the count of the first page, then the number of rows of the whole set, then every change of it', () => {
    know('kind-a');
    usePods.mockReturnValue(view({ rows: someRows(256), complete: false, firstCount: { kind: 'estimate', value: '5025' } }));
    const { rerender } = mount('kind-a');
    expect(getOpenCounts().get(pods)).toEqual({ value: 5025, approximate: true });

    usePods.mockReturnValue(view({ rows: someRows(5026), complete: true }));
    rerender(context('kind-a'));
    expect(getOpenCounts().get(pods)).toBe(5026);

    usePods.mockReturnValue(view({ rows: someRows(5025), complete: true }));
    rerender(context('kind-a'));
    expect(getOpenCounts().get(pods)).toBe(5025);
  });

  it('does not say it again when nothing it says changed: a render of the page that changes no count is not a publication', () => {
    know('kind-a');
    usePods.mockReturnValue(view({ rows: someRows(3), complete: true }));
    const { rerender } = mount('kind-a');
    const published = getOpenCounts();

    usePods.mockReturnValue(view({ rows: someRows(3), complete: true, refreshing: true }));
    rerender(context('kind-a'));

    expect(getOpenCounts()).toBe(published);
  });

  it('takes it back when the page goes: the kind is not open any more, and the sidebar reads its count again', () => {
    know('kind-a');
    usePods.mockReturnValue(view({ rows: someRows(3), complete: true }));
    const { unmount } = mount('kind-a');
    expect(getOpenCounts().has(pods)).toBe(true);

    unmount();

    expect(getOpenCounts().has(pods)).toBe(false);
  });

  it('says nothing while there is no connection to read: it is not the list of anything yet', () => {
    know();
    usePods.mockReturnValue(view({ rows: someRows(3), complete: true }));

    mount();

    expect(getOpenCounts().size).toBe(0);
  });

  it('says it for the connection the page reads, and takes it back when the page reads another', () => {
    know('kind-a', 'kind-b');
    usePods.mockReturnValue(view({ rows: someRows(3), complete: true }));
    const { rerender } = mount('kind-a');
    expect([...getOpenCounts().keys()]).toEqual([pods]);

    rerender(context('kind-b'));

    expect([...getOpenCounts().keys()]).toEqual([openKey('kubernetes', 'kind-b', 'k8s:/pods')]);
  });

  it('says it for the plugin id the host installed the plugin under', () => {
    know('kind-a');
    usePods.mockReturnValue(view({ rows: someRows(3), complete: true }));

    mount('kind-a', 'kubernetes-qa');

    expect([...getOpenCounts().keys()]).toEqual([openKey('kubernetes-qa', 'kind-a', 'k8s:/pods')]);
  });

  it('says it for the kind the page lists: a Deployments page says the Deployment type', () => {
    know('kind-a');
    usePods.mockReturnValue(view({ rows: someRows(7), complete: true }));

    renderHook((props: ContextV1) => listPage(deploymentDefinition).usePage(props), { initialProps: { plugin: 'kubernetes', route: { page: 'deployments', connection: 'kind-a', params: {} } } as ContextV1 });

    expect([...getOpenCounts().entries()]).toEqual([[openKey('kubernetes', 'kind-a', 'k8s:apps/deployments'), 7]]);
  });
});

// A list the user may not read (the host answered FORBIDDEN): asking again cannot help, so there is no Retry, and the words are the plugin's, naming the kind and where it was read. What came over the
// wire is not on the screen: the host's own text for a refusal is a fixed one that says nothing (docs/ui-next/status/K2b-2.md found the page showing it, with a Retry that could not help).
describe('usePodsPage: a list the user may not read', () => {
  const denied = { kind: 'denied', message: 'The operation could not be completed.' } as const;

  it('says so in the plugin\'s own words, naming the kind and every namespace, and offers no Retry', () => {
    know('kind-a');
    usePods.mockReturnValue(view({ state: denied, complete: false, namespaced: true }));

    const { source } = mount('kind-a').result.current;

    expect(source.state).toEqual({ kind: 'failed', message: 'You do not have permission to list Pods in all namespaces.' });
    expect(source.state).not.toHaveProperty('retry');
  });

  it('says this cluster for a kind that lives in no namespace', () => {
    know('kind-a');
    usePods.mockReturnValue(view({ state: denied, complete: false, namespaced: false }));

    const { result } = renderHook((props: ContextV1) => listPage(nodeDefinition).usePage(props), { initialProps: { plugin: 'kubernetes', route: { page: 'nodes', connection: 'kind-a', params: {} } } as ContextV1 });

    expect(result.current.source.state).toEqual({ kind: 'failed', message: 'You do not have permission to list Nodes in this cluster.' });
  });

  it('keeps the page usable and the lane in place: the page is a refusal, not a page that is gone', () => {
    know('kind-a');
    usePods.mockReturnValue(view({ state: denied, complete: false, namespaced: true }));

    const { frame } = mount('kind-a').result.current;

    expect(frame.scope?.map((face) => face.text)).toEqual(['kind-a', 'All namespaces']);
  });

  it('says no count for a whole set that is kept beside a refusal: its rows are not how many objects the kind has now', () => {
    know('kind-a');
    const someRows = Array.from({ length: 3 }, (_, index) => ({ key: `k${String(index)}` })) as unknown as PodsView['rows'];
    usePods.mockReturnValue(view({ state: { kind: 'loaded' }, failure: { kind: 'denied', message: 'The operation could not be completed.' }, rows: someRows, loaded: 3, complete: true, namespaced: true }));

    mount('kind-a');

    expect(getOpenCounts().get(openKey('kubernetes', 'kind-a', 'k8s:/pods'))).toBeNull();
  });

  it('takes the count back when a read is refused after the whole set was here, and says it again when it is not refused any more', () => {
    know('kind-a');
    const someRows = Array.from({ length: 3 }, (_, index) => ({ key: `k${String(index)}` })) as unknown as PodsView['rows'];
    const pods = openKey('kubernetes', 'kind-a', 'k8s:/pods');
    usePods.mockReturnValue(view({ rows: someRows, loaded: 3, complete: true }));
    const { rerender } = mount('kind-a');
    expect(getOpenCounts().get(pods)).toBe(3);

    usePods.mockReturnValue(view({ failure: { kind: 'denied' }, rows: someRows, loaded: 3, complete: true }));
    rerender(context('kind-a'));
    expect(getOpenCounts().get(pods)).toBeNull();

    usePods.mockReturnValue(view({ rows: someRows, loaded: 3, complete: true }));
    rerender(context('kind-a'));
    expect(getOpenCounts().get(pods)).toBe(3);
  });

  it('says nothing to the sidebar that is a count: the list that is refused has none to say', () => {
    know('kind-a');
    usePods.mockReturnValue(view({ state: denied, rows: [], complete: false, firstCount: undefined, namespaced: true }));

    mount('kind-a');

    expect(getOpenCounts().get(openKey('kubernetes', 'kind-a', 'k8s:/pods'))).toBeNull();
  });
});
