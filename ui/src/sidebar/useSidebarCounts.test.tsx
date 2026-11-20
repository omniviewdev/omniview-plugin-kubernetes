import type { Count } from '@omniviewdev/runtime/ui/v1';
import * as runtime from '@omniviewdev/runtime/ui/v1';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACCESS, CLUSTER, CONFIG, KINDS, NETWORK, SIDEBAR_GROUPS, STORAGE, WORKLOADS } from '../kinds';

import type { SidebarCounts } from './count';
import { openKey, publishOpenCount, resetOpenCounts } from './openCounts';
import { ALL_NAMESPACES, type NamespaceScope } from './scope';
import { REFRESH_MS } from './store';
import { fake, hooks, isCount, type FakeRead } from './testing';
import { useSidebarCounts, type SidebarCountsInput } from './useSidebarCounts';

// The sidebar's counts are read through the runtime's own hooks, a pool of four slots at a time, for what is on screen. The runtime is a fake that keeps count of the reads it is asked for (`./testing.ts`): a read
// starts when a request key appears, is in flight until the test answers it, and is dropped, cancelled if it is in flight, when its last observer goes, as the real `useResources` does with `gcTime: 0`.
// The factory loads the fakes itself: `vi.mock` is hoisted above the imports of this file, which a static import of the fakes could not be seen from.
vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  const { hooks: fakes } = await import('./testing');
  return { ...actual, ...fakes };
});

const GROUPS = SIDEBAR_GROUPS.map((group) => group.id);
const types = (reads: readonly FakeRead[]): readonly string[] => reads.map((read) => read.type);
const typesOf = (kinds: ReadonlyArray<{ readonly type: string }>): readonly string[] => kinds.map((kind) => kind.type);

const NODES = CLUSTER[0];
const PODS = WORKLOADS[0];
const SECRETS = CONFIG[1];

const input = (over: Partial<SidebarCountsInput> = {}): SidebarCountsInput => ({ plugin: 'kubernetes', connection: 'kind-a', open: [], scope: ALL_NAMESPACES, ...over });
const mount = (over: Partial<SidebarCountsInput> = {}) => renderHook<SidebarCounts, SidebarCountsInput>((props) => useSidebarCounts(props), { initialProps: input(over) });

/** What the sidebar draws for an entry: the number, or none (`null`: the slot is held, with nothing in it). */
const shown = (counts: SidebarCounts, page: string) => counts.get(page) ?? null;

const oneOf = (...namespaces: readonly string[]): NamespaceScope => ({ kind: 'oneOf', namespaces });

/** What the runtime says of a read the user may not make (the shape `useKindRows.test.tsx` uses for the same thing), and of one that was refused with the 403 the host maps it to. */
const FORBIDDEN = { code: 'FORBIDDEN', title: '', message: 'Source session failed.' };
const FORBIDDEN_403 = { type: 'omniview:resource/forbidden', title: 'Access denied', status: 403, detail: 'The operation could not be completed.' };

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

describe('the read of a count: a page of one, through the target resolved for the kind', () => {
  it('resolves the target of the kind in the connection, and reads a page of one of it: no collection, no live source', () => {
    mount({ open: [] });

    expect(hooks.useResolvedResourceTarget).toHaveBeenCalledWith({ pluginID: 'kubernetes', route: { connection: 'kind-a' }, type: NODES?.type, scope: undefined, enabled: true });
    const [read] = fake.counts();
    expect(read).toBeDefined();
    expect(hooks.useResources).toHaveBeenCalledWith({
      pluginID: 'kubernetes',
      request: { targetId: read?.targetId, request: { target: expect.objectContaining({ type: NODES?.type, route: { connection: 'kind-a' } }) as unknown, pageSize: 1 } },
      collection: false,
    });
  });

  it('reads through the plugin id the host installed the plugin under', () => {
    mount({ plugin: 'kubernetes-qa' });

    for (const hook of [hooks.useResolvedResourceTarget, hooks.useResources]) {
      expect(hook).toHaveBeenCalledWith(expect.objectContaining({ pluginID: 'kubernetes-qa' }));
      expect(hook).not.toHaveBeenCalledWith(expect.objectContaining({ pluginID: 'kubernetes' }));
    }
  });

  it('reads the catalog once for the whole sidebar, and the connection\'s readiness once, not once for each kind', () => {
    mount({ open: GROUPS });
    fake.drain();

    const catalogCalls = hooks.useResourceTypes.mock.calls.filter(([options]) => options.enabled !== false);
    expect(catalogCalls.length).toBeGreaterThan(0);
    for (const [options] of catalogCalls) {
      expect(options).toEqual({ pluginID: 'kubernetes', route: { connection: 'kind-a' }, enabled: true });
    }
    expect(hooks.useConnectionReadiness).toHaveBeenCalledWith({ pluginID: 'kubernetes', connectionID: 'kind-a', enabled: true });
  });

  it('draws nothing for a kind while its read is on its way: the slot is held and empty', () => {
    const { result } = mount({ open: [] });

    expect(fake.pending(isCount)).toHaveLength(2);
    expect(shown(result.current, NODES?.page ?? '')).toBeNull();
  });
});

describe('what each kind of answer draws', () => {
  it.each<[string, Count | undefined, unknown]>([
    ['an exact count', { kind: 'exact', value: '12' }, 12],
    ['an exact count of nothing', { kind: 'exact', value: '0' }, 0],
    ['an estimate', { kind: 'estimate', value: '1200' }, { value: 1200, approximate: true }],
    ['an unknown count', { kind: 'unknown' }, null],
    ['a page that carries no count', undefined, null],
    ['a value that is not a canonical decimal', { kind: 'exact', value: '007' }, null],
    ['a value beyond the numbers that count exactly', { kind: 'exact', value: '9007199254740993' }, null],
  ])('draws %s as %j', (_name, count, expected) => {
    fake.script(NODES?.type ?? '', { count });
    const { result } = mount({ open: [] });

    fake.drain();

    expect(shown(result.current, NODES?.page ?? '')).toEqual(expected);
  });

  it('draws each kind its own answer, and no kind another\'s', () => {
    fake.script(PODS?.type ?? '', { count: { kind: 'exact', value: '5025' } });
    fake.script(CONFIG[0]?.type ?? '', { count: { kind: 'estimate', value: '300' } });
    const { result } = mount({ open: ['workloads', 'config'] });

    fake.drain();

    expect(shown(result.current, 'pods')).toBe(5025);
    expect(shown(result.current, 'configmaps')).toEqual({ value: 300, approximate: true });
    expect(shown(result.current, 'deployments')).toBe(1);
  });

  it('keeps the number while the count is read again, and draws the new one when it arrives', () => {
    fake.script(NODES?.type ?? '', { count: { kind: 'exact', value: '3' } });
    const { result } = mount({ open: [] });
    fake.drain();
    expect(shown(result.current, 'nodes')).toBe(3);

    fake.script(NODES?.type ?? '', { count: { kind: 'exact', value: '4' } });
    act(() => {
      vi.advanceTimersByTime(REFRESH_MS);
    });
    expect(fake.pending(isCount).map((read) => read.type)).toContain(NODES?.type);
    expect(shown(result.current, 'nodes')).toBe(3);

    fake.drain();
    expect(shown(result.current, 'nodes')).toBe(4);
  });
});

describe('the cost of counting: only what is on screen, four reads at a time, and not again before it is due', () => {
  it('reads each of the 29 kinds once when every group is open, all of them a page of one, never more than four at a time, and then nothing for 30 s', () => {
    expect(KINDS).toHaveLength(29);
    mount({ open: GROUPS });
    // The four slots are full as soon as the sidebar is on screen.
    expect(fake.pending(isCount)).toHaveLength(4);

    fake.drain();

    expect(fake.counts()).toHaveLength(29);
    expect([...types(fake.counts())].sort()).toEqual([...typesOf(KINDS)].sort());
    expect(fake.reads.every((read) => read.pageSize === 1 && !read.collection)).toBe(true);
    expect(fake.peak).toBe(4);
    expect(fake.cancelled()).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(fake.reads).toHaveLength(29);
    expect(fake.pending()).toEqual([]);
  });

  it('keeps four reads in flight while there is a kind left to read, and never more, whichever read answers first', () => {
    mount({ open: GROUPS });

    for (let guard = 0; guard < 100 && fake.pending(isCount).length > 0; guard += 1) {
      const last = fake.pending(isCount).at(-1);
      expect(last).toBeDefined();
      act(() => {
        fake.answer(last as FakeRead);
      });
      expect(fake.pending(isCount)).toHaveLength(fake.counts().length < 29 ? 4 : 29 - fake.counts().filter((read) => read.state === 'answered').length);
    }

    expect(fake.counts()).toHaveLength(29);
    expect(fake.peak).toBe(4);
  });

  it('reads the top level only while no group is open: Nodes and Namespaces are always on screen', () => {
    mount({ open: [] });
    fake.drain();

    expect(types(fake.counts())).toEqual(typesOf(CLUSTER));
  });

  it('reads the kinds of the groups that are open, and of those only', () => {
    mount({ open: ['network'] });
    fake.drain();

    expect(types(fake.counts())).toEqual([...typesOf(CLUSTER), ...typesOf(NETWORK)]);
  });

  it('reads in the order of the sidebar, whatever order the host lists the open groups in', () => {
    mount({ open: ['storage', 'workloads'] });
    fake.drain();

    expect(types(fake.counts())).toEqual([...typesOf(CLUSTER), ...typesOf(WORKLOADS), ...typesOf(STORAGE)]);
  });

  it('ignores an open group it has no kinds for', () => {
    mount({ open: ['nowhere', 'access'] });
    fake.drain();

    expect(types(fake.counts())).toEqual([...typesOf(CLUSTER), ...typesOf(ACCESS)]);
  });

  it('reads every count again when the refresh interval is over, four at a time, and not before', () => {
    mount({ open: GROUPS });
    fake.drain();
    expect(fake.counts()).toHaveLength(29);

    act(() => {
      vi.advanceTimersByTime(REFRESH_MS - 1);
    });
    expect(fake.counts()).toHaveLength(29);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(fake.pending(isCount)).toHaveLength(4);

    fake.drain();
    expect(fake.counts()).toHaveLength(58);
    expect(fake.peak).toBe(4);
  });

  it('does not read again, when a group is collapsed and opened again within the interval, what it has read', () => {
    const { rerender } = mount({ open: ['workloads'] });
    fake.drain();
    expect(fake.counts()).toHaveLength(9);

    rerender(input({ open: [] }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    rerender(input({ open: ['workloads'] }));

    expect(fake.counts()).toHaveLength(9);
    expect(fake.pending()).toEqual([]);
  });

  it('reads again, when a group is opened after its counts are old, what is on screen', () => {
    const { rerender } = mount({ open: ['workloads'] });
    fake.drain();
    rerender(input({ open: [] }));
    act(() => {
      vi.advanceTimersByTime(REFRESH_MS + 1);
    });
    expect(fake.counts()).toHaveLength(11);
    fake.drain();

    rerender(input({ open: ['workloads'] }));

    // The top level was read again by the interval; the workloads are read again now, being old, and the top level is not read twice.
    expect(types(fake.pending(isCount))).toEqual(typesOf(WORKLOADS).slice(0, 4));
  });

  it('stops the reads of a group that is collapsed: what is in flight is cancelled, and none of its kinds is read later', () => {
    const { rerender } = mount({ open: GROUPS });
    expect(types(fake.pending(isCount))).toEqual([...typesOf(CLUSTER), ...typesOf(WORKLOADS).slice(0, 2)]);

    rerender(input({ open: GROUPS.filter((id) => id !== 'workloads') }));

    // The reads of Pods and Deployments were in flight, and are cancelled; their slots go to the next kinds on screen, which are the first of Config.
    expect(types(fake.cancelled())).toEqual(typesOf(WORKLOADS).slice(0, 2));
    expect(types(fake.pending(isCount))).toEqual([...typesOf(CLUSTER), ...typesOf(CONFIG).slice(0, 2)]);

    fake.drain();
    const asked = types(fake.counts());
    for (const type of typesOf(WORKLOADS).slice(2)) {
      expect(asked).not.toContain(type);
    }
    expect(asked.filter((type) => type === PODS?.type)).toHaveLength(1);
    expect(fake.peak).toBe(4);
  });

  it('reads only the kinds of a group that is opened: what it has read, it does not read again', () => {
    const { rerender } = mount({ open: [] });
    fake.drain();
    expect(types(fake.counts())).toEqual(typesOf(CLUSTER));

    rerender(input({ open: ['workloads'] }));
    expect(types(fake.pending(isCount))).toEqual(typesOf(WORKLOADS).slice(0, 4));
    fake.drain();

    expect(types(fake.counts())).toEqual([...typesOf(CLUSTER), ...typesOf(WORKLOADS)]);
  });

  it('reads nothing when it renders again: not on every render, not while a read is on its way, not for an open list that is the same list', () => {
    const { rerender } = mount({ open: GROUPS });
    expect(fake.counts()).toHaveLength(4);

    for (let render = 0; render < 3; render += 1) {
      rerender(input({ open: [...GROUPS], scope: { kind: 'all' } }));
    }
    expect(fake.counts()).toHaveLength(4);

    fake.drain();
    for (let render = 0; render < 3; render += 1) {
      rerender(input({ open: [...GROUPS], scope: { kind: 'all' } }));
    }

    expect(fake.counts()).toHaveLength(29);
  });

  it('stops everything when the sidebar goes away: its reads are cancelled and no timer is left to read later', () => {
    const { unmount } = mount({ open: GROUPS });
    expect(fake.pending(isCount)).toHaveLength(4);

    unmount();

    expect(fake.pending()).toEqual([]);
    expect(fake.cancelled()).toHaveLength(4);

    const second = mount({ open: [] });
    fake.drain();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reads the counts of another connection when it is told to: they are that connection\'s own', () => {
    const { rerender } = mount({ open: [] });
    fake.drain();

    rerender(input({ open: [], connection: 'kind-b' }));

    expect(fake.pending(isCount)).toHaveLength(2);
    expect(hooks.useResolvedResourceTarget).toHaveBeenCalledWith(expect.objectContaining({ route: { connection: 'kind-b' }, enabled: true }));
    expect(fake.pending(isCount).map((read) => read.connection)).toEqual(['kind-b', 'kind-b']);
  });
});

describe('the scope: counts follow the namespaces chosen', () => {
  const resolved = () => hooks.useResolvedResourceTarget.mock.calls.map(([options]) => options).filter((options) => options.enabled === true);
  const resolvedFor = (type: string) => resolved().filter((options) => options.type === type);

  it('reads every namespace with no constraint when the scope is all of them, for a namespaced kind and a cluster-scoped one alike', () => {
    mount({ open: ['workloads'] });
    fake.drain();

    expect(resolved().length).toBeGreaterThan(0);
    for (const options of resolved()) {
      expect(options.scope).toBeUndefined();
    }
  });

  it('puts the namespaces chosen, sorted and each once, on the target of a namespaced kind, and nothing on a kind that lives in no namespace', () => {
    mount({ open: ['workloads'], scope: oneOf('b', 'a', 'b') });
    fake.drain();

    for (const type of typesOf(WORKLOADS)) {
      expect(resolvedFor(type).every((options) => JSON.stringify(options.scope) === JSON.stringify([{ dimension: 'namespace', match: 'oneOf', values: ['a', 'b'] }]))).toBe(true);
      expect(resolvedFor(type).length).toBeGreaterThan(0);
    }
    for (const type of typesOf(CLUSTER)) {
      expect(resolvedFor(type).length).toBeGreaterThan(0);
      expect(resolvedFor(type).every((options) => options.scope === undefined)).toBe(true);
    }
  });

  it('reads again when the scope changes: the namespaced kinds, with the new constraint; a kind of the cluster counts the same in any scope and is not read again', () => {
    const { rerender } = mount({ open: ['workloads'] });
    fake.drain();
    const before = fake.counts().length;
    expect(before).toBe(9);

    rerender(input({ open: ['workloads'], scope: oneOf('dev') }));
    fake.drain();

    expect(types(fake.counts().slice(before))).toEqual(typesOf(WORKLOADS));
    expect(fake.peak).toBe(4);
    for (const read of fake.counts().slice(before)) {
      expect(read.targetId).toContain('"dev"');
    }
  });

  it('draws what the new scope answers, and the old answer is not drawn for it', () => {
    fake.script(PODS?.type ?? '', { count: { kind: 'exact', value: '100' } });
    const { result, rerender } = mount({ open: ['workloads'] });
    fake.drain();
    expect(shown(result.current, 'pods')).toBe(100);

    fake.script(PODS?.type ?? '', { count: { kind: 'exact', value: '7' } });
    rerender(input({ open: ['workloads'], scope: oneOf('dev') }));
    expect(shown(result.current, 'pods')).toBeNull();
    fake.drain();

    expect(shown(result.current, 'pods')).toBe(7);
  });

  it('does not read again when the scope goes back to what it was within the interval: the answers of that scope are still good', () => {
    const { rerender } = mount({ open: ['workloads'] });
    fake.drain();
    rerender(input({ open: ['workloads'], scope: oneOf('dev') }));
    fake.drain();
    const before = fake.counts().length;

    rerender(input({ open: ['workloads'] }));

    expect(fake.counts()).toHaveLength(before);
  });

  it('does not read again for a new object that says the same choice', () => {
    const { rerender } = mount({ open: ['workloads'], scope: oneOf('b', 'a') });
    fake.drain();
    const before = fake.counts().length;

    rerender(input({ open: ['workloads'], scope: oneOf('a', 'b', 'a') }));

    expect(fake.counts()).toHaveLength(before);
    expect(fake.pending()).toEqual([]);
  });

  it('draws nothing for a scope of several namespaces, which the backend cannot count: it answers unknown', () => {
    fake.script(PODS?.type ?? '', { count: { kind: 'unknown' } });
    const { result } = mount({ open: ['workloads'], scope: oneOf('a', 'b') });

    fake.drain();

    expect(shown(result.current, 'pods')).toBeNull();
  });
});

describe('a kind the user may not list', () => {
  it.each([['FORBIDDEN', FORBIDDEN], ['a 403', FORBIDDEN_403]])('draws no count for it when its read says %s, and draws the others', (_name, error) => {
    fake.script(SECRETS?.type ?? '', { error });
    const { result } = mount({ open: ['config'] });

    fake.drain();

    expect(shown(result.current, 'secrets')).toBeNull();
    expect(shown(result.current, 'configmaps')).toBe(1);
    expect(shown(result.current, 'limitranges')).toBe(1);
    expect(shown(result.current, 'nodes')).toBe(1);
    expect(fake.counts()).toHaveLength(8);
  });

  it('frees the slot of a refused read, so that the kinds after it are read', () => {
    fake.script(CONFIG[0]?.type ?? '', { error: FORBIDDEN });
    fake.script(CONFIG[1]?.type ?? '', { error: FORBIDDEN });
    const { result } = mount({ open: ['config'] });

    fake.drain();

    expect(shown(result.current, 'resourcequotas')).toBe(1);
    expect(shown(result.current, 'poddisruptionbudgets')).toBe(1);
    expect(fake.counts()).toHaveLength(8);
  });

  // A refusal is final until the user does something that asks again: repeated 403s every minute are noise in a cluster's audit log, and can trip an alert, for exactly the users this state is for.
  describe('a kind it was refused on is not asked again on a timer', () => {
    const secrets = () => fake.counts().filter((read) => read.type === SECRETS?.type);
    const advance = (ms: number) => {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
      fake.drain();
    };

    it.each([['FORBIDDEN', FORBIDDEN], ['a 403', FORBIDDEN_403]])('reads it once, and not again in five minutes, while the other kinds are read each minute (%s)', (_name, error) => {
      fake.script(SECRETS?.type ?? '', { error });
      mount({ open: ['config'] });
      fake.drain();
      const configmaps = () => fake.counts().filter((read) => read.type === CONFIG[0]?.type);
      expect(secrets()).toHaveLength(1);

      for (let minute = 1; minute <= 5; minute += 1) {
        advance(REFRESH_MS);
        expect(configmaps()).toHaveLength(minute + 1);
      }

      expect(secrets()).toHaveLength(1);
    });

    it('reads it again, once, when its group is opened again: at once, and after any time', () => {
      fake.script(SECRETS?.type ?? '', { error: FORBIDDEN });
      const { rerender } = mount({ open: ['config'] });
      fake.drain();
      expect(secrets()).toHaveLength(1);

      rerender(input({ open: [] }));
      rerender(input({ open: ['config'] }));
      fake.drain();
      expect(secrets()).toHaveLength(2);

      rerender(input({ open: [] }));
      advance(10 * REFRESH_MS);
      rerender(input({ open: ['config'] }));
      fake.drain();
      expect(secrets()).toHaveLength(3);

      advance(5 * REFRESH_MS);
      expect(secrets()).toHaveLength(3);
    });

    it('reads it again, once, when the connection changes: the refusal was of the connection that said it', () => {
      fake.script(SECRETS?.type ?? '', { error: FORBIDDEN });
      const { rerender } = mount({ open: ['config'] });
      fake.drain();

      rerender(input({ open: ['config'], connection: 'kind-b' }));
      fake.drain();
      advance(5 * REFRESH_MS);

      expect(secrets().map((read) => read.connection)).toEqual(['kind-a', 'kind-b']);
    });

    it('reads it again, once, when the namespaces counted change, for a kind that has namespaces', () => {
      fake.script(SECRETS?.type ?? '', { error: FORBIDDEN });
      const { rerender } = mount({ open: ['config'] });
      fake.drain();
      expect(secrets()).toHaveLength(1);

      rerender(input({ open: ['config'], scope: oneOf('a') }));
      fake.drain();
      advance(5 * REFRESH_MS);

      expect(secrets()).toHaveLength(2);
    });

    it('does not read a kind that has no namespaces again when the namespaces counted change: its count is the same in any of them', () => {
      fake.script(STORAGE[0]?.type ?? '', { error: FORBIDDEN });
      const { rerender } = mount({ open: ['storage'] });
      fake.drain();
      const volumes = () => fake.counts().filter((read) => read.type === STORAGE[0]?.type);
      expect(volumes()).toHaveLength(1);

      rerender(input({ open: ['storage'], scope: oneOf('a') }));
      fake.drain();
      advance(5 * REFRESH_MS);

      expect(volumes()).toHaveLength(1);
    });

    it('reads it again, once, when its list was open and is left: the user went to see, and the sidebar looks again', () => {
      fake.script(SECRETS?.type ?? '', { error: FORBIDDEN });
      mount({ open: ['config'] });
      fake.drain();
      expect(secrets()).toHaveLength(1);

      let leave = () => {};
      act(() => {
        leave = publishOpenCount(openKey('kubernetes', 'kind-a', SECRETS?.type ?? ''), null);
      });
      advance(5 * REFRESH_MS);
      expect(secrets()).toHaveLength(1);

      act(() => {
        leave();
      });
      fake.drain();
      advance(5 * REFRESH_MS);

      expect(secrets()).toHaveLength(2);
    });

    it('reads a kind that failed some other way again at the interval, like the rest: only a refusal is final', () => {
      fake.script(SECRETS?.type ?? '', { error: new Error('connection reset') });
      mount({ open: ['config'] });
      fake.drain();
      expect(secrets()).toHaveLength(1);

      advance(REFRESH_MS - 1);
      expect(secrets()).toHaveLength(1);

      advance(1);
      expect(secrets()).toHaveLength(2);
    });
  });

  it('draws no count for a read that failed some other way, or was cancelled by the runtime, and asks again after the interval, not at once', () => {
    fake.script(NODES?.type ?? '', { error: new Error('connection reset') });
    fake.script(CLUSTER[1]?.type ?? '', { error: { name: 'AbortError' } });
    const { result } = mount({ open: [] });

    fake.drain();

    expect(shown(result.current, 'nodes')).toBeNull();
    expect(shown(result.current, 'namespaces')).toBeNull();
    expect(fake.counts()).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(fake.counts()).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(fake.counts()).toHaveLength(4);
  });

  it('draws no count for a kind whose target cannot be resolved, reads nothing for it, and goes on to the others', () => {
    fake.failTarget(SECRETS?.type ?? '', FORBIDDEN);
    const { result } = mount({ open: ['config'] });

    fake.drain();

    expect(shown(result.current, 'secrets')).toBeNull();
    expect(shown(result.current, 'resourcequotas')).toBe(1);
    expect(types(fake.counts())).not.toContain(SECRETS?.type);
    expect(fake.counts()).toHaveLength(7);
  });

  // A target that failed stays in the runtime's cache with its error while it is resolved again (`isFetching`); the error is the last attempt's, and the attempt that is on its way may well succeed.
  it('does not take the old error of a target that is being resolved again for an answer: the slot waits for the attempt, and the others go on', () => {
    fake.failTarget(SECRETS?.type ?? '', FORBIDDEN, { fetching: true });
    const { result } = mount({ open: ['config'] });

    fake.drain();
    expect(shown(result.current, 'secrets')).toBeNull();
    expect(fake.counts()).toHaveLength(7);
    expect(fake.pending()).toEqual([]);

    // The attempt ends and fails: the slot is settled with no count, and the kind is read again only at the interval.
    act(() => {
      fake.failTarget(SECRETS?.type ?? '', FORBIDDEN);
    });
    act(() => {
      vi.advanceTimersByTime(REFRESH_MS - 1);
    });
    expect(shown(result.current, 'secrets')).toBeNull();
    expect(fake.counts()).toHaveLength(7);
  });

  it('reads the kind when the attempt that was on its way succeeds', () => {
    fake.failTarget(SECRETS?.type ?? '', FORBIDDEN, { fetching: true });
    const { result } = mount({ open: ['config'] });
    fake.drain();
    expect(fake.counts()).toHaveLength(7);

    act(() => {
      fake.clearTarget(SECRETS?.type ?? '');
    });
    fake.drain();

    expect(types(fake.counts())).toContain(SECRETS?.type);
    expect(shown(result.current, 'secrets')).toBe(1);
  });
});

describe('a connection that is not connected: a read never connects (plan D4)', () => {
  it.each(['checking', 'connecting', 'disconnected', 'unauthorized', 'forbidden', 'not-found', 'error'] as const)('reads nothing while the connection is %s, and does not start it', (phase) => {
    fake.set({ phase });
    const { result } = mount({ open: GROUPS });

    expect(fake.reads).toEqual([]);
    expect(shown(result.current, 'pods')).toBeNull();
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it('reads nothing while the plugin has no connection to read: the connections are on their way, or it has none', () => {
    const { result } = mount({ open: GROUPS, connection: undefined });

    expect(fake.reads).toEqual([]);
    expect(shown(result.current, 'nodes')).toBeNull();
    expect(hooks.useConnectionReadiness).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(hooks.useResourceTypes).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('starts reading when the connection becomes connected', () => {
    fake.set({ phase: 'connecting' });
    mount({ open: [] });
    expect(fake.reads).toEqual([]);

    act(() => {
      fake.set({ phase: 'connected' });
    });

    expect(fake.pending(isCount)).toHaveLength(2);
  });

  it('forgets what it read when the connection stops being connected, cancels what is in flight, and reads again when it is back, at once', () => {
    fake.script(PODS?.type ?? '', { count: { kind: 'exact', value: '9' } });
    const { result } = mount({ open: ['workloads'] });
    fake.drain();
    expect(shown(result.current, 'pods')).toBe(9);

    act(() => {
      fake.set({ phase: 'disconnected' });
    });
    expect(shown(result.current, 'pods')).toBeNull();
    expect(fake.pending()).toEqual([]);

    act(() => {
      fake.set({ phase: 'connected' });
    });
    expect(fake.pending(isCount)).toHaveLength(4);
    fake.drain();

    expect(fake.counts()).toHaveLength(18);
    expect(shown(result.current, 'pods')).toBe(9);
  });

  it('cancels the reads that are in flight when the connection is lost', () => {
    mount({ open: GROUPS });
    expect(fake.pending(isCount)).toHaveLength(4);

    act(() => {
      fake.set({ phase: 'error' });
    });

    expect(fake.pending()).toEqual([]);
    expect(fake.cancelled()).toHaveLength(4);
  });
});

describe('a kind the catalog does not serve: there is nothing to read', () => {
  it('reads the kinds it serves and not the others', () => {
    fake.serve(KINDS.filter((kind) => kind.page !== 'secrets' && kind.page !== 'storageclasses'));
    const { result } = mount({ open: GROUPS });

    fake.drain();

    expect(fake.counts()).toHaveLength(27);
    expect(types(fake.counts())).not.toContain(SECRETS?.type);
    expect(shown(result.current, 'secrets')).toBeNull();
    expect(shown(result.current, 'storageclasses')).toBeNull();
    expect(shown(result.current, 'pods')).toBe(1);
  });

  it('reads nothing until the catalog has answered, and then what it serves', () => {
    fake.set({ types: undefined });
    mount({ open: GROUPS });
    expect(fake.reads).toEqual([]);

    act(() => {
      fake.serve(WORKLOADS);
    });

    expect(types(fake.pending(isCount))).toEqual([...typesOf(WORKLOADS).slice(0, 4)]);
  });

  it('reads nothing of a kind that is added to the catalog later until it is on screen', () => {
    fake.serve(CLUSTER);
    mount({ open: ['workloads'] });
    fake.drain();
    expect(fake.counts()).toHaveLength(2);

    act(() => {
      fake.serve([...CLUSTER, ...WORKLOADS]);
    });

    expect(types(fake.pending(isCount))).toEqual(typesOf(WORKLOADS).slice(0, 4));
  });
});

describe('a kind whose list is open: its count is the list\'s, with no second request', () => {
  const pods = openKey('kubernetes', 'kind-a', PODS?.type ?? '');

  it('is not read: the list says how many, from the source it lists', () => {
    publishOpenCount(pods, 12);
    const { result } = mount({ open: GROUPS });

    fake.drain();

    expect(fake.counts()).toHaveLength(28);
    expect(types(fake.counts())).not.toContain(PODS?.type);
    expect(shown(result.current, 'pods')).toBe(12);
  });

  it('follows the list as its count changes, and draws an estimate as one', () => {
    const withdraw = publishOpenCount(pods, 12);
    const { result } = mount({ open: ['workloads'] });
    fake.drain();

    withdraw();
    act(() => {
      publishOpenCount(pods, 13);
    });
    expect(shown(result.current, 'pods')).toBe(13);
    expect(fake.pending()).toEqual([]);
  });

  it('is not read while the list is open, though it has no number to say yet', () => {
    publishOpenCount(pods, null);
    const { result } = mount({ open: ['workloads'] });

    fake.drain();

    expect(types(fake.counts())).not.toContain(PODS?.type);
    expect(shown(result.current, 'pods')).toBeNull();
  });

  it('is read once the list goes: the count falls back to a read', () => {
    const withdraw = publishOpenCount(pods, 12);
    const { result } = mount({ open: ['workloads'] });
    fake.drain();
    expect(shown(result.current, 'pods')).toBe(12);

    fake.script(PODS?.type ?? '', { count: { kind: 'exact', value: '14' } });
    act(() => {
      withdraw();
    });
    expect(types(fake.pending(isCount))).toEqual([PODS?.type]);
    fake.drain();

    expect(shown(result.current, 'pods')).toBe(14);
  });

  it('keeps what it read before the list opened until the list has a number to say, and then draws the list\'s', () => {
    fake.script(PODS?.type ?? '', { count: { kind: 'exact', value: '5' } });
    const { result } = mount({ open: ['workloads'] });
    fake.drain();
    expect(shown(result.current, 'pods')).toBe(5);

    act(() => {
      publishOpenCount(pods, null);
    });
    expect(shown(result.current, 'pods')).toBe(5);

    act(() => {
      publishOpenCount(pods, { value: 99, approximate: true });
    });
    expect(shown(result.current, 'pods')).toEqual({ value: 99, approximate: true });
  });

  it('does not read a kind whose list is open even when its group is collapsed, and stops reading it when its list opens', () => {
    const { rerender } = mount({ open: [] });
    fake.drain();
    rerender(input({ open: ['workloads'] }));
    expect(types(fake.pending(isCount))).toEqual(typesOf(WORKLOADS).slice(0, 4));

    act(() => {
      publishOpenCount(pods, 3);
    });

    // The read of Pods that was in flight is cancelled with its slot.
    expect(types(fake.cancelled())).toEqual([PODS?.type]);
    expect(types(fake.pending(isCount))).toEqual(typesOf(WORKLOADS).slice(1, 5));
  });

  it('is not another connection\'s list, nor another plugin id\'s: only the list of this sidebar\'s kind, in this sidebar\'s connection', () => {
    publishOpenCount(openKey('kubernetes', 'kind-b', PODS?.type ?? ''), 12);
    publishOpenCount(openKey('kubernetes-qa', 'kind-a', PODS?.type ?? ''), 13);
    const { result } = mount({ open: ['workloads'] });

    fake.drain();

    expect(types(fake.counts())).toContain(PODS?.type);
    expect(shown(result.current, 'pods')).toBe(1);
  });

  it('is the list\'s only for the scope the list reads, which is every namespace: another scope asks for its own count of a namespaced kind', () => {
    publishOpenCount(pods, 12);
    const { result } = mount({ open: ['workloads'], scope: oneOf('dev') });

    fake.drain();

    expect(types(fake.counts())).toContain(PODS?.type);
    expect(shown(result.current, 'pods')).toBe(1);
  });

  it('is the list\'s for a kind that lives in no namespace, whatever the scope: a Node counts the same in every namespace', () => {
    publishOpenCount(openKey('kubernetes', 'kind-a', NODES?.type ?? ''), 4);
    const { result } = mount({ open: [], scope: oneOf('dev') });

    fake.drain();

    expect(types(fake.counts())).not.toContain(NODES?.type);
    expect(shown(result.current, 'nodes')).toBe(4);
  });
});
