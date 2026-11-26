import * as runtime from '@omniviewdev/runtime/ui/v1';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextV1, SidebarContextV1, SidebarNodeV1 } from '../contract/v1';
import { CONFIG, KINDS, SIDEBAR_GROUPS, WORKLOADS, sidebarNodes } from '../kinds';
import { listPage } from '../kinds/list';
import { podDefinition } from '../kinds/pods/definition';
import { hostRecord } from '../kinds/testing';
import { connectionOf, hostOf, viewOf } from '../landing/testing';

import { openKey, publishOpenCount, resetOpenCounts } from './openCounts';
import { fake, hooks, isCount, type FakeRead } from './testing';
import { useSidebarNodes } from './useSidebarNodes';

// The sidebar's `useNodes`: what the host calls with the context every hook gets and the groups that are open. It answers the skeleton's nodes with the counts the plugin has read, and nothing (so that the
// skeleton stays) while it does not know which connection it is for. The reads themselves, what they cost and what they say are `useSidebarCounts.test.tsx`'s; here is what the host is handed.
vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  const { hooks: fakes } = await import('./testing');
  return { ...actual, ...fakes };
});

const GROUPS = SIDEBAR_GROUPS.map((group) => group.id);
const PODS = WORKLOADS[0];
const SECRETS = CONFIG[1];

/** What the host tells the hook: the plugin it is installed under, the route of the page on screen, the groups of the tree that are open and the plugin's connections. */
const context = (open: readonly string[] = [], connection: string | undefined = 'kind-a', plugin = 'kubernetes', page = 'pods', params: Readonly<Record<string, string>> = {}, connections = hostOf(viewOf()).connections): SidebarContextV1 => ({
  plugin,
  route: { page, connection, params },
  open,
  connections,
});
const mount = (initial: SidebarContextV1 = context()) => renderHook((props: SidebarContextV1) => useSidebarNodes(props), { initialProps: initial });

const leaves = (nodes: readonly SidebarNodeV1[]): readonly SidebarNodeV1[] => nodes.flatMap((node) => (node.children === undefined ? [node] : leaves(node.children)));
const countOf = (nodes: readonly SidebarNodeV1[] | undefined, id: string) => leaves(nodes ?? []).find((leaf) => leaf.id === id)?.count;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  fake.reset(KINDS);
});

afterEach(() => {
  cleanup();
  resetOpenCounts();
  vi.useRealTimers();
});

describe('useSidebarNodes: which connection it is for', () => {
  it('answers nothing while the plugin\'s connections are on their way, so that the skeleton stays', () => {
    fake.set({ connectionsPending: true });

    expect(mount().result.current).toBeUndefined();
    expect(fake.reads).toEqual([]);
  });

  it('answers nothing for a plugin that has no connection, and reads nothing', () => {
    fake.set({ connections: [] });

    expect(mount(context(GROUPS)).result.current).toBeUndefined();
    expect(fake.reads).toEqual([]);
  });

  it('is for the connection the route names, when the plugin knows it', () => {
    fake.set({ connections: [{ id: 'kind-a' }, { id: 'kind-b' }] });

    mount(context([], 'kind-b'));

    expect(hooks.useConnectionReadiness).toHaveBeenCalledWith({ pluginID: 'kubernetes', connectionID: 'kind-b', enabled: true });
    expect(hooks.useResolvedResourceTarget).toHaveBeenCalledWith(expect.objectContaining({ route: { connection: 'kind-b' }, enabled: true }));
  });

  it('is for the plugin\'s first connection when the route names none, or one the plugin does not know: the choice the pages make', () => {
    fake.set({ connections: [{ id: 'kind-a' }, { id: 'kind-b' }] });

    mount(context([], undefined));
    mount(context([], 'ghost'));

    expect(hooks.useConnectionReadiness).not.toHaveBeenCalledWith(expect.objectContaining({ connectionID: 'ghost' }));
    expect(hooks.useConnectionReadiness).not.toHaveBeenCalledWith(expect.objectContaining({ connectionID: 'kind-b' }));
    expect(hooks.useConnectionReadiness).toHaveBeenCalledWith({ pluginID: 'kubernetes', connectionID: 'kind-a', enabled: true });
  });

  it('reads under the plugin id the host tells it', () => {
    mount(context(GROUPS, 'kind-a', 'kubernetes-qa'));

    expect(hooks.useResources).toHaveBeenCalledWith(expect.objectContaining({ pluginID: 'kubernetes-qa' }));
    expect(hooks.useResources).not.toHaveBeenCalledWith(expect.objectContaining({ pluginID: 'kubernetes' }));
  });
});

describe('useSidebarNodes: the nodes it answers', () => {
  it('are the skeleton\'s, with the slot of every kind held and no number in it, until a count has been read; the Overview is no kind and holds no slot', () => {
    const { result } = mount();

    expect(result.current).toEqual(sidebarNodes());
    for (const leaf of leaves(result.current ?? [])) {
      if (leaf.id === 'overview') {
        expect(leaf).not.toHaveProperty('count');
      } else {
        expect(leaf.count, leaf.id).toBeNull();
      }
    }
  });

  it('give a group no count: only an entry has one', () => {
    const { result } = mount(context(GROUPS));
    fake.drain();

    for (const node of result.current ?? []) {
      if (node.children !== undefined) {
        expect(node).not.toHaveProperty('count');
      }
    }
  });

  it('draw the counts as they arrive: a number for an exact count, an approximate one for an estimate, and none for what is unknown or refused', () => {
    fake.script(PODS?.type ?? '', { count: { kind: 'exact', value: '1234' } });
    fake.script(WORKLOADS[1]?.type ?? '', { count: { kind: 'estimate', value: '300' } });
    fake.script(WORKLOADS[2]?.type ?? '', { count: { kind: 'unknown' } });
    fake.script(SECRETS?.type ?? '', { error: { code: 'FORBIDDEN', title: '', message: 'Source session failed.' } });
    fake.script(CONFIG[0]?.type ?? '', { count: { kind: 'exact', value: '0' } });
    const { result } = mount(context(GROUPS));

    fake.drain();

    expect(countOf(result.current, 'pods')).toBe(1234);
    expect(countOf(result.current, 'deployments')).toEqual({ value: 300, approximate: true });
    expect(countOf(result.current, 'statefulsets')).toBeNull();
    expect(countOf(result.current, 'secrets')).toBeNull();
    expect(countOf(result.current, 'configmaps')).toBe(0);
    expect(countOf(result.current, 'nodes')).toBe(1);
    // A row stays an entry that opens its page, with its words and its glyph, whatever its count says.
    expect(leaves(result.current ?? []).map((leaf) => leaf.id)).toEqual(leaves(sidebarNodes()).map((leaf) => leaf.id));
  });

  it('keep every other word of the skeleton: the ids, the labels, the glyphs, the groups and their order', () => {
    const { result } = mount(context(GROUPS));
    fake.drain();

    const strip = (nodes: readonly SidebarNodeV1[]): unknown => nodes.map(({ count: _count, children, ...rest }) => ({ ...rest, ...(children === undefined ? {} : { children: strip(children) }) }));

    expect(strip(result.current ?? [])).toEqual(strip(sidebarNodes()));
  });

  it('are the same array for as long as no count changes: a render of the host runs nothing again', () => {
    const { result, rerender } = mount(context(GROUPS));
    fake.drain();
    const first = result.current;

    rerender(context(GROUPS));
    rerender(context([...GROUPS]));

    expect(result.current).toBe(first);
  });

  it('are another array when a count arrives', () => {
    const { result } = mount(context(['workloads']));
    const first = result.current;

    act(() => {
      fake.answer(fake.pending(isCount)[0] as FakeRead);
    });

    expect(result.current).not.toBe(first);
    expect(countOf(result.current, 'nodes')).toBe(1);
  });

  it('are the skeleton\'s again, with no number, when the connection is not connected: nothing is read, so there is nothing to say', () => {
    fake.set({ phase: 'disconnected' });

    const { result } = mount(context(GROUPS));

    expect(result.current).toEqual(sidebarNodes());
    expect(fake.reads).toEqual([]);
    expect(fake.connect).not.toHaveBeenCalled();
  });
});

describe('useSidebarNodes: only what is on screen is counted', () => {
  it('reads the top level and the groups the host says are open, and no group that is closed', () => {
    const { rerender } = mount(context([]));
    fake.drain();
    expect(fake.counts()).toHaveLength(2);

    rerender(context(['workloads']));
    fake.drain();
    expect(fake.counts()).toHaveLength(9);

    rerender(context(['workloads', 'config']));
    fake.drain();
    expect(fake.counts()).toHaveLength(15);
  });

  it('stops reading a group when the host says it is closed: what was in flight for it is cancelled, and nothing of it is read later', () => {
    const { rerender } = mount(context(GROUPS));
    expect(fake.pending(isCount)).toHaveLength(4);

    rerender(context([]));

    // Pods and Deployments were in flight; Nodes and Namespaces, the top level, are still on screen.
    expect(fake.cancelled().map((read) => read.type)).toEqual([PODS?.type, WORKLOADS[1]?.type]);
    expect(fake.pending(isCount)).toHaveLength(2);
    fake.drain();
    expect(fake.counts()).toHaveLength(4);
  });
});

describe('useSidebarNodes: a kind whose list is open', () => {
  it('draws the list\'s count, and reads no second one', () => {
    publishOpenCount(openKey('kubernetes', 'kind-a', PODS?.type ?? ''), 12);
    const { result } = mount(context(['workloads']));

    fake.drain();

    expect(countOf(result.current, 'pods')).toBe(12);
    expect(fake.counts().map((read) => read.type)).not.toContain(PODS?.type);
  });

  it('follows the list live', () => {
    publishOpenCount(openKey('kubernetes', 'kind-a', PODS?.type ?? ''), 12);
    const { result } = mount(context(['workloads']));
    fake.drain();

    act(() => {
      publishOpenCount(openKey('kubernetes', 'kind-a', PODS?.type ?? ''), 13);
    });

    expect(countOf(result.current, 'pods')).toBe(13);
  });
});

// The page of a kind and the sidebar are two components of the host that share the module's registry and nothing else: here both run, on one fake runtime, with the page the plugin contributes.
describe('the sidebar and the list of a kind, together', () => {
  const pods = listPage(podDefinition);
  const page: ContextV1 = { plugin: 'kubernetes', route: { page: 'pods', connection: 'kind-a', params: {} } };
  const podRecord = (name: string) => hostRecord({ metadata: { name, namespace: 'checkout' }, status: { phase: 'Running' } }, `row:checkout/${name}`);
  const listReads = () => fake.pending((read) => read.type === PODS?.type && read.pageSize > 1);

  it('draws the count of the open list from the list\'s own reads, the estimate of its first page and then the whole of it, and reads no page of one of that kind', () => {
    const list = renderHook((props: ContextV1) => pods.usePage(props), { initialProps: page });
    const { result } = mount(context(['workloads']));
    expect(fake.pending(isCount).map((read) => read.type)).toEqual(KINDS.filter((kind) => kind.page !== 'pods').slice(0, 4).map((kind) => kind.type));

    const [collection, first] = [listReads().find((read) => read.collection), listReads().find((read) => !read.collection)];
    expect(collection).toBeDefined();
    expect(first).toBeDefined();

    // The first page answers before the collection does: its count is what the source says, here an estimate.
    act(() => {
      fake.answer(first as NonNullable<typeof first>, { count: { kind: 'estimate', value: '5025' }, records: [podRecord('a'), podRecord('b')] });
    });
    expect(countOf(result.current, 'pods')).toEqual({ value: 5025, approximate: true });

    // The collection completes: the count is the number of its rows, exact.
    act(() => {
      fake.answer(collection as NonNullable<typeof collection>, { count: { kind: 'exact', value: '3' }, records: [podRecord('a'), podRecord('b'), podRecord('c')] });
    });
    expect(countOf(result.current, 'pods')).toBe(3);
    expect(pods.kind).toBe('list');

    fake.drain();
    expect(fake.counts().map((read) => read.type)).not.toContain(PODS?.type);

    // The list goes (its tab is closed): the count falls back to a read of its own.
    fake.script(PODS?.type ?? '', { count: { kind: 'exact', value: '4' } });
    list.unmount();
    expect(fake.pending(isCount).map((read) => read.type)).toEqual([PODS?.type]);
    fake.drain();
    expect(countOf(result.current, 'pods')).toBe(4);
  });

  it('cancels a read of the kind that was in flight when its list opened', () => {
    const { result } = mount(context(['workloads']));
    expect(fake.pending(isCount).map((read) => read.type)).toContain(PODS?.type);

    renderHook((props: ContextV1) => pods.usePage(props), { initialProps: page });

    expect(fake.cancelled().map((read) => read.type)).toEqual([PODS?.type]);
    fake.drain();
    expect(fake.counts().filter((read) => read.type === PODS?.type)).toHaveLength(1);
    expect(countOf(result.current, 'pods')).toBeNull();
  });
});

describe('useSidebarNodes: on a page of the landing', () => {
  const MIX = [
    connectionOf('alpha', 'connected'),
    connectionOf('beta', 'unauthorized', { reason: 'The connection needs you to sign in.' }),
    connectionOf('gamma', 'disconnected'),
  ];

  it('answers the navigator and not the skeleton, reads no connection, follows what the host says of the connections, starts its group of the connections open, and carries the facets of the page on screen (its route\'s parameters) to the entries of the states, so that the entry that is the page on screen has the page\'s very parameters', () => {
    const host = hostOf(viewOf(...MIX));
    const { result, rerender } = mount(context([], undefined, 'kubernetes', 'connections', {}, host.connections));

    // Which connection is read for is none: nothing is counted, though the plugin has a first connection that a page of a connection would read.
    expect(fake.reads).toEqual([]);
    expect(hooks.useConnectionReadiness).not.toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));

    const nodes = result.current ?? [];
    expect(nodes.map((node) => [node.id, node.label, node.count])).toEqual([
      ['landing', 'Kubernetes', undefined],
      ['connections-all', 'All connections', 3],
      ['connections-connected', 'Connected', 1],
      ['connections-attention', 'Needs attention', 1],
      ['connection-list', 'Connections', 3],
    ]);
    // A leaf that opens the page with a parameter is the page and its parameters; the host's word for a connection that needs a look is its badge; the group of the connections says that it starts open.
    expect(nodes.slice(1, 4).map((node) => [node.page, node.params])).toEqual([['connections', {}], ['connections', { state: 'connected' }], ['connections', { state: 'attention' }]]);
    expect(nodes[4]).toMatchObject({ expanded: true });
    const alpha = nodes[4]?.children?.[0];
    const beta = nodes[4]?.children?.[1];
    expect(alpha).toMatchObject({ label: 'alpha', connection: 'alpha' });
    expect(alpha).not.toHaveProperty('status');
    expect(beta?.status).toEqual({ role: 'attention', label: 'Needs sign-in' });

    // A state that changes is a new answer; one the page of a connection would not see.
    act(() => {
      host.set(viewOf(...MIX.map((connection) => (connection.key === 'gamma' ? connectionOf('gamma', 'connected') : connection))));
    });
    expect(result.current?.[2]?.count).toBe(2);

    // The page on screen has a state and two platforms chosen: every entry of a state opens the page with those platforms kept, and the one for its state has the route's very parameters.
    const chosen = { state: 'attention', platform: 'EKS,kind' };
    rerender(context([], undefined, 'kubernetes', 'connections', chosen, host.connections));
    expect(result.current?.slice(1, 4).map((node) => node.params)).toEqual([{ platform: 'EKS,kind' }, { state: 'connected', platform: 'EKS,kind' }, chosen]);
  });
});
