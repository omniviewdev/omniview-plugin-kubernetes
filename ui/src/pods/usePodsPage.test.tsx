import * as runtime from '@omniviewdev/runtime/ui/v1';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextV1 } from '../contract/v1';

import * as data from './data';
import { usePodsPage } from './usePodsPage';

import { podsPage } from './index';

// The data layer is its own seam, tested in ./data: here `usePods` answers a view, and the runtime answers the list of connections. What is under
// test is what the page hands the host: which connection it reads, what it puts in the frame, what the page lists and in what state, and the one
// connection it starts.
vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  return { ...actual, useConnections: vi.fn() };
});
vi.mock('./data', async (importActual) => {
  const actual = await importActual<typeof data>();
  return { ...actual, usePods: vi.fn() };
});

const connections = vi.mocked(runtime.useConnections);
const usePods = vi.mocked(data.usePods);
const connect = vi.fn(async () => undefined);

function view(over: Partial<data.PodsView> = {}): data.PodsView {
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
  vi.clearAllMocks();
});

describe('usePodsPage: which connection it reads', () => {
  it('reads the connection the route names, when the plugin knows it', () => {
    know('kind-a', 'kind-b');
    mount('kind-b');
    expect(usePods).toHaveBeenCalledWith({ pluginID: 'kubernetes', connectionID: 'kind-b' });
  });

  it('reads the first connection when the route names none, or one the plugin does not know', () => {
    know('kind-a', 'kind-b');
    mount();
    expect(usePods).toHaveBeenLastCalledWith({ pluginID: 'kubernetes', connectionID: 'kind-a' });
    cleanup();
    mount('kind-gone');
    expect(usePods).toHaveBeenLastCalledWith({ pluginID: 'kubernetes', connectionID: 'kind-a' });
  });

  it('reads the plugin it is installed under: the id the host tells it', () => {
    know('kind-a');
    mount('kind-a', 'kubernetes-qa');
    expect(connections).toHaveBeenCalledWith({ plugin: 'kubernetes-qa' });
    expect(usePods).toHaveBeenCalledWith({ pluginID: 'kubernetes-qa', connectionID: 'kind-a' });
  });

  it('reads nothing while there is no connection to read, and says it is loading while the list of connections is on its way', () => {
    connections.mockReturnValue({ connections: { data: undefined, isPending: true } } as never);
    const { result } = mount();
    expect(usePods).toHaveBeenLastCalledWith({ pluginID: 'kubernetes', connectionID: undefined });
    expect(result.current.source.state).toEqual({ kind: 'loading' });
    expect(result.current.source.rows).toEqual([]);
  });

  it('says "No connections", with nothing to retry, when the plugin has none (or is not installed)', () => {
    connections.mockReturnValue({ connections: { data: [], isPending: false } } as never);
    const { result } = mount();
    expect(usePods).toHaveBeenLastCalledWith({ pluginID: 'kubernetes', connectionID: undefined });
    expect(result.current.source.state).toEqual({ kind: 'failed', message: 'No connections' });
    expect(result.current.source.complete).toBe(false);
  });

  it('reads another connection when the route changes to it', () => {
    know('kind-a', 'kind-b');
    const { rerender } = mount('kind-a');
    expect(usePods).toHaveBeenLastCalledWith({ pluginID: 'kubernetes', connectionID: 'kind-a' });
    rerender(context('kind-b'));
    expect(usePods).toHaveBeenLastCalledWith({ pluginID: 'kubernetes', connectionID: 'kind-b' });
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

  it('has no connection to show in the path or the scope lane when the route names none', () => {
    know('kind-a');
    const { frame } = mount().result.current;
    expect(frame.path).toEqual(['Kubernetes', 'Pods']);
    expect(frame.scope).toBeUndefined();
  });

  it('hands over the rows and the state of what usePods read', () => {
    know('kind-a');
    const rows = [{ key: 'k1', name: 'cart-api-1', namespace: 'checkout' }] as unknown as data.PodsView['rows'];
    usePods.mockReturnValue(view({ rows, loaded: 1, complete: false, state: { kind: 'loaded' } }));
    const { source } = mount('kind-a').result.current;
    expect(source.rows).toBe(rows);
    expect(source.complete).toBe(false);
    expect(source.state).toEqual({ kind: 'ready' });
  });
});

describe('podsPage: what it contributes', () => {
  it('is a list page: the hook above, and the Pods list: its title and nouns, the quick filters of the definition, and the columns of its default set', () => {
    expect(podsPage.kind).toBe('list');
    expect(podsPage.usePage).toBe(usePodsPage);
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
