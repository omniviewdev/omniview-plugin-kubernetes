import { LinkProvider, type LinkHandler } from '@omniviewdev/kit';
import type { HostRecord } from '@omniviewdev/runtime/ui/v1';
import * as runtime from '@omniviewdev/runtime/ui/v1';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { Activity, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextV1, DetailKvSection, DetailListSection, DetailPageViewV1, DetailTableSection } from '../contract/v1';
import { KINDS } from '../kinds';
import { cronJobDefinition } from '../kinds/cronjobs/definition';
import { daemonSetDefinition } from '../kinds/daemonsets/definition';
import { deploymentDefinition } from '../kinds/deployments/definition';
import { jobDefinition } from '../kinds/jobs/definition';
import { listPage } from '../kinds/list';
import { namespaceDefinition } from '../kinds/namespaces/definition';
import { nodeDefinition } from '../kinds/nodes/definition';
import { persistentVolumeClaimDefinition } from '../kinds/persistentvolumeclaims/definition';
import { podDefinition } from '../kinds/pods/definition';
import { statefulSetDefinition } from '../kinds/statefulsets/definition';
import { hostRecord } from '../kinds/testing';
import { resetOpenCounts } from '../sidebar/openCounts';
import { fake, hooks, type FakeRead } from '../sidebar/testing';

import type { WorkloadRow } from './model';
import { useOverviewPage } from './useOverviewPage';

// The overview's one data hook (the contribution contract's `usePage` of an overview page): which connection it reads, the nine kinds it reads and the connection's facts, and the state it hands the host. The runtime is
// a fake that keeps count of the reads it is asked for (`sidebar/testing.ts`): a read starts when a request key appears, is in flight until the test answers it, and is dropped, cancelled if it is in flight, when
// its last observer goes, as the real `useResources` does with `gcTime: 0`. What is under test is what the page opens and hands the host; what each section says of what it is given is `model.test.ts`, and how it
// draws is `view.test.tsx`. The factory loads the fakes itself: `vi.mock` is hoisted above the imports of this file, which a static import of the fakes could not be seen from.
vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  const { hooks: fakes } = await import('../sidebar/testing');
  return { ...actual, ...fakes };
});

/** The page as the host mounts it: a component that runs the page's hook. */
function Page({ context }: { readonly context: ContextV1 }) {
  useOverviewPage(context);
  return null;
}

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const MINUTE = 60_000;
const iso = (ago: number) => new Date(NOW - ago).toISOString();

/** The nine kinds the page reads, in the order it reads them, and the types of their reads. */
const READ = [podDefinition, deploymentDefinition, statefulSetDefinition, daemonSetDefinition, jobDefinition, cronJobDefinition, persistentVolumeClaimDefinition, nodeDefinition, namespaceDefinition];
const TYPES = READ.map((kind) => kind.type);

const CONTEXT: ContextV1 = { plugin: 'kubernetes', route: { page: 'overview', connection: 'kind-a', params: {} } };
const mount = (context: ContextV1 = CONTEXT) => renderHook((props: ContextV1) => useOverviewPage(props), { initialProps: context });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  fake.reset(KINDS);
});

afterEach(() => {
  cleanup();
  resetOpenCounts();
  vi.useRealTimers();
});

// --- what a cluster serves ---------------------------------------------------------------------------------------------------------------------------------------------

const records = (type: string, objects: readonly unknown[]): readonly HostRecord[] => objects.map((object, index) => hostRecord(object, `${type}:${index}`, type));

const pod = (name: string, status: Record<string, unknown>, namespace = 'shop') => ({ metadata: { name, namespace, creationTimestamp: iso(60 * MINUTE) }, spec: { containers: [{ name: 'app' }] }, status });
const running = (ready: boolean) => ({ phase: 'Running', containerStatuses: [{ name: 'app', ready, restartCount: 0, state: { running: {} } }] });
const crashing = { phase: 'Running', containerStatuses: [{ name: 'app', ready: false, restartCount: 3, state: { waiting: { reason: 'CrashLoopBackOff' } } }] };
const deployment = (name: string, replicas: number, ready: number) => ({ metadata: { name, namespace: 'shop' }, spec: { replicas }, status: { readyReplicas: ready, availableReplicas: ready, updatedReplicas: replicas } });
const node = (name: string, ready: 'True' | 'False') => ({ metadata: { name }, status: { conditions: [{ type: 'Ready', status: ready }], nodeInfo: { kubeletVersion: 'v1.35.0' } } });
const claim = (name: string, phase: string, age: number) => ({ metadata: { name, namespace: 'shop', creationTimestamp: iso(age) }, status: { phase } });
const failedJob = { metadata: { name: 'migrate', namespace: 'shop' }, spec: { completions: 1 }, status: { failed: 1, conditions: [{ type: 'Failed', status: 'True' }] } };

/** A cluster with trouble in it: a Pod in CrashLoopBackOff and one that is not ready, a Deployment short of replicas, a Job that failed, a Node that is down and a claim that has waited ten minutes. */
const TROUBLE: Readonly<Record<string, readonly HostRecord[]>> = {
  [podDefinition.type]: records(podDefinition.type, [pod('api-1', crashing), pod('api-2', running(false)), pod('web-1', running(true)), pod('web-2', running(true))]),
  [deploymentDefinition.type]: records(deploymentDefinition.type, [deployment('api', 3, 1), deployment('web', 2, 2)]),
  [jobDefinition.type]: records(jobDefinition.type, [failedJob]),
  [nodeDefinition.type]: records(nodeDefinition.type, [node('node-1', 'True'), node('node-2', 'False'), node('node-3', 'True')]),
  [persistentVolumeClaimDefinition.type]: records(persistentVolumeClaimDefinition.type, [claim('data', 'Pending', 10 * MINUTE), claim('logs', 'Bound', 60 * MINUTE)]),
  [namespaceDefinition.type]: records(namespaceDefinition.type, Array.from({ length: 12 }, (_, index) => ({ metadata: { name: `ns-${index}` }, status: { phase: 'Active' } }))),
};

type Answers = Readonly<Record<string, readonly HostRecord[]>>;

/** Answers the reads in flight: for each type the records the test gives it (none, when it gives none), the whole collections, and with `firsts` the first pages too. */
function answer(answers: Answers = {}, { collections = true, firsts = false }: { readonly collections?: boolean; readonly firsts?: boolean } = {}): void {
  act(() => {
    for (const read of fake.pending()) {
      if ((read.collection && collections) || (!read.collection && firsts)) {
        fake.answer(read, { records: answers[read.type] ?? [] });
      }
    }
  });
}

const FORBIDDEN = { code: 'FORBIDDEN', title: '', message: 'Source session failed.' };
const UNAVAILABLE = { type: 'omniview:connection/failed', title: 'x', status: 503, detail: 'The cluster did not answer.', code: 'UNAVAILABLE' };

/** Fails the collection read of a type. */
function fail(type: string, error: unknown): void {
  const read = fake.pending((candidate) => candidate.type === type && candidate.collection)[0];
  if (read === undefined) {
    throw new Error(`no collection of ${type} is in flight`);
  }

  act(() => {
    fake.answer(read, { error });
  });
}

// --- what the page hands the host ---------------------------------------------------------------------------------------------------------------------------------

const handler: LinkHandler = { hrefOf: ({ page, params }) => `#/${page}?${new URLSearchParams(params).toString()}`, onOpen: () => undefined };

/** What a node draws as, in text: the page's titles and cells are links and glyphs, and the tests read what they say. */
function say(node: ReactNode): string {
  const { container, unmount } = render(<LinkProvider handler={handler}><span>{node}</span></LinkProvider>);
  const text = container.textContent ?? '';
  unmount();
  return text;
}

const overview = ({ source }: DetailPageViewV1) => {
  const tab = source.view?.tabs.overview;
  if (tab?.kind !== 'overview') {
    throw new Error('the page has no Overview tab to draw');
  }

  return tab;
};
const attention = (page: DetailPageViewV1) => overview(page).sections.find((section) => section.id === 'attention') as DetailListSection | undefined;
const workloads = (page: DetailPageViewV1) => overview(page).sections.find((section) => section.id === 'workloads') as DetailTableSection<WorkloadRow> | undefined;
const cluster = (page: DetailPageViewV1) => overview(page).sections.find((section) => section.id === 'cluster') as DetailKvSection;
const clusterRow = (page: DetailPageViewV1, id: string) => say(cluster(page).rows.find((row) => row.id === id)?.value);
const titles = (page: DetailPageViewV1) => attention(page)?.rows.map((row) => say(row.title));

const OBSERVED = '2026-11-25T11:56:00.000Z';
const current = (value: unknown) => ({ state: 'current', value, observedAt: OBSERVED });
const FACTS = {
  'kubernetes.server.version': current('v1.31.4-eks-aeac579'),
  'kubernetes.server': current('https://ABC.gr7.eu-west-1.eks.amazonaws.com'),
  'kubernetes.platform': current('eks'),
  'kubernetes.distribution': current('eks'),
};
const snapshot = (entries: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ connectionID: 'kind-a', generation: 'g1', revision: '1', active: true, refreshing: false, entries, ...over });
const facts = (entries: Record<string, unknown> = FACTS, over: Record<string, unknown> = {}) => {
  act(() => {
    fake.set({ metadata: { supported: true, transportAvailable: true, snapshot: snapshot(entries, over), isLoading: false, error: undefined } });
  });
};

describe('the reads the page opens, and when', () => {
  it('reads nothing until it is on screen: a page that is not mounted holds no read and calls no hook', () => {
    expect(fake.reads).toEqual([]);
    for (const hook of Object.values(hooks)) {
      expect(hook).not.toHaveBeenCalled();
    }
  });

  it('opens, on a connected cluster, a collection and a first page of 256 for each of the nine kinds it reads, and nothing else: the cost of the page', () => {
    mount();

    const collections = fake.reads.filter((read) => read.collection);
    const firsts = fake.reads.filter((read) => !read.collection);
    expect(collections.map((read) => read.type).sort()).toEqual([...TYPES].sort());
    expect(firsts.map((read) => read.type).sort()).toEqual([...TYPES].sort());
    expect(fake.reads.every((read) => read.pageSize === 256 && read.connection === 'kind-a')).toBe(true);
    expect(fake.reads).toHaveLength(18);
    expect(fake.counts()).toEqual([]);
  });

  it('keeps the nine collections and lets the first pages go once the collections have answered: a first page is read only until the whole set is here', () => {
    mount();
    answer();

    expect(fake.reads.filter((read) => read.observers > 0).map((read) => [read.collection, read.pageSize])).toEqual(Array.from({ length: 9 }, () => [true, 256]));
    expect(fake.cancelled().every((read) => !read.collection)).toBe(true);
  });

  it('reads the connection\'s state, the catalog and the facts for the page, not for each kind: the arguments are the same for every kind', () => {
    mount();

    for (const hook of [hooks.useConnectionReadiness, hooks.useResourceTypes]) {
      const calls = hook.mock.calls.map(([options]) => JSON.stringify(options));
      expect(new Set(calls).size, hook.getMockName()).toBe(1);
    }
    expect(hooks.useConnectionReadiness).toHaveBeenCalledWith({ pluginID: 'kubernetes', connectionID: 'kind-a', enabled: true });
    expect(hooks.useResourceTypes).toHaveBeenCalledWith({ pluginID: 'kubernetes', route: { connection: 'kind-a' }, enabled: true });
    expect(hooks.useConnectionMetadata).toHaveBeenLastCalledWith({ pluginID: 'kubernetes', connectionID: 'kind-a', enabled: true });
  });

  it('reads through the plugin id the host installed the plugin under', () => {
    mount({ ...CONTEXT, plugin: 'kubernetes-qa' });

    for (const hook of [hooks.useConnectionReadiness, hooks.useResourceTypes, hooks.useResolvedResourceTarget, hooks.useResources]) {
      expect(hook).toHaveBeenCalledWith(expect.objectContaining({ pluginID: 'kubernetes-qa' }));
      expect(hook).not.toHaveBeenCalledWith(expect.objectContaining({ pluginID: 'kubernetes' }));
    }
    expect(hooks.useConnectionMetadata).toHaveBeenCalledWith({ pluginID: 'kubernetes-qa', connectionID: 'kind-a', enabled: true });
  });

  it('opens no read for a kind the cluster does not serve', () => {
    fake.serve(KINDS.filter((kind) => kind.type !== jobDefinition.type && kind.type !== cronJobDefinition.type));
    mount();

    expect(new Set(fake.reads.map((read) => read.type))).toEqual(new Set(TYPES.filter((type) => type !== jobDefinition.type && type !== cronJobDefinition.type)));
  });

  it('reads nothing while the connection is not connected: the page starts it and reads what it holds once it is ready', () => {
    fake.set({ phase: 'connecting' });
    mount();

    expect(fake.reads).toEqual([]);
    expect(hooks.useConnectionMetadata).toHaveBeenLastCalledWith({ pluginID: 'kubernetes', connectionID: 'kind-a', enabled: false });
    act(() => {
      fake.set({ phase: 'connected' });
    });
    expect(fake.reads).toHaveLength(18);
    expect(hooks.useConnectionMetadata).toHaveBeenLastCalledWith({ pluginID: 'kubernetes', connectionID: 'kind-a', enabled: true });
  });

  it('reads nothing while the plugin\'s connections are on their way, and nothing when it has none', () => {
    fake.set({ connectionsPending: true });
    mount();
    expect(fake.reads).toEqual([]);
    expect(hooks.useConnectionReadiness).toHaveBeenLastCalledWith({ pluginID: 'kubernetes', connectionID: '', enabled: false });
    cleanup();

    fake.set({ connectionsPending: false, connections: [] });
    mount();
    expect(fake.reads).toEqual([]);
    expect(hooks.useConnectionMetadata).toHaveBeenLastCalledWith({ pluginID: 'kubernetes', connectionID: undefined, enabled: false });
  });

  it('reads the connection the route names, and the plugin\'s first when it names none the plugin knows', () => {
    fake.set({ connections: [{ id: 'kind-a' }, { id: 'kind-b' }] });
    mount({ ...CONTEXT, route: { ...CONTEXT.route, connection: 'kind-b' } });
    expect(new Set(fake.reads.map((read) => read.connection))).toEqual(new Set(['kind-b']));
    cleanup();

    fake.reset(KINDS);
    fake.set({ connections: [{ id: 'kind-a' }, { id: 'kind-b' }] });
    mount({ ...CONTEXT, route: { ...CONTEXT.route, connection: 'kind-gone' } });
    expect(new Set(fake.reads.map((read) => read.connection))).toEqual(new Set(['kind-a']));
  });

  it('drops every read when the page goes: what is in flight is cancelled, and nothing is left observed', () => {
    const { unmount } = mount();
    expect(fake.pending()).toHaveLength(18);

    unmount();

    expect(fake.reads.every((read) => read.observers === 0)).toBe(true);
    expect(fake.pending()).toEqual([]);
    expect(fake.cancelled()).toHaveLength(18);
  });

  // The host keeps the pages of the tabs that are not shown mounted and hidden, in React's `Activity` (`ui-next/shell/tabs/PageHost.tsx`): a hidden page keeps its state and its effects are stopped, which is what stops its reads.
  it('reads nothing while it is hidden, and reads again when it is shown: a page that is not on screen holds no read', () => {
    const page = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <Page context={CONTEXT} />
      </Activity>
    );
    const { rerender } = render(page('visible'));
    expect(fake.pending()).toHaveLength(18);

    rerender(page('hidden'));
    expect(fake.pending()).toEqual([]);
    expect(fake.reads.every((read) => read.observers === 0)).toBe(true);

    rerender(page('visible'));
    expect(fake.pending()).toHaveLength(18);
  });
});

describe('the state of the page: the connection\'s, and nothing else', () => {
  const state = (page: DetailPageViewV1) => page.source.state;

  it('is loading while the plugin\'s connections are on their way, with nothing to draw', () => {
    fake.set({ connectionsPending: true });
    const { result } = mount();

    expect(state(result.current)).toEqual({ kind: 'loading' });
    expect(result.current.source.view).toBeUndefined();
  });

  it('says "No connections", with nothing to retry, when the plugin has none: the words the lists say', () => {
    fake.set({ connections: [] });
    const { result } = mount();
    const list = renderHook(() => listPage(podDefinition).usePage(CONTEXT)).result.current;

    expect(state(result.current)).toEqual({ kind: 'failed', message: 'No connections' });
    expect(state(result.current)).toEqual(list.source.state);
  });

  it.each(['checking', 'connecting'] as const)('is loading while the connection is %s', (phase) => {
    fake.set({ phase });
    const { result } = mount();

    expect(state(result.current)).toEqual({ kind: 'loading' });
    expect(result.current.source.view).toBeUndefined();
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it('is loading while the connection is stopped, and starts it, once: a read never connects, so the page does, as the lists do', () => {
    fake.set({ phase: 'disconnected' });
    const { result, rerender } = mount();

    expect(state(result.current)).toEqual({ kind: 'loading' });
    expect(fake.connect).toHaveBeenCalledTimes(1);
    rerender(CONTEXT);
    rerender(CONTEXT);
    expect(fake.connect).toHaveBeenCalledTimes(1);
  });

  it('does not start a connection that is running, and starts none when there is none', () => {
    mount();
    expect(fake.connect).not.toHaveBeenCalled();
    cleanup();

    fake.set({ phase: 'disconnected', connections: [] });
    mount();
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it('is failed with the runtime\'s words and a Retry that asks the connection again, when the connection needs sign-in or did not answer', () => {
    fake.set({ phase: 'unauthorized', message: 'The provider requires authentication.' });
    const { result } = mount();
    const failed = state(result.current);

    expect(failed).toMatchObject({ kind: 'failed', message: 'The provider requires authentication.' });
    if (failed.kind !== 'failed') {
      throw new Error('failed expected');
    }

    failed.retry?.();
    expect(fake.connectionRetry).toHaveBeenCalledTimes(1);
    expect(result.current.source.view).toBeUndefined();
  });

  it('says what the Pods list says for each state of the connection', () => {
    for (const [phase, message] of [['unauthorized', undefined], ['error', 'resource operation failed'], ['not-found', undefined], ['connecting', undefined], ['disconnected', undefined]] as const) {
      fake.reset(KINDS);
      fake.set({ phase, message });
      const page = mount().result.current.source.state;
      const list = renderHook(() => listPage(podDefinition).usePage(CONTEXT)).result.current.source.state;
      cleanup();

      expect(page.kind, phase).toBe(list.kind);
      expect(page, phase).toMatchObject(list.kind === 'failed' ? { message: list.message } : {});
      expect('retry' in page && page.retry !== undefined, phase).toBe(list.kind === 'failed' && list.retry !== undefined);
    }
  });

  it('is failed with nothing to retry for a connection that is gone, and denied for one the user may not use', () => {
    fake.set({ phase: 'not-found' });
    expect(state(mount().result.current)).toEqual({ kind: 'failed', message: 'This connection no longer exists.' });
    cleanup();

    fake.set({ phase: 'forbidden' });
    expect(state(mount().result.current)).toEqual({ kind: 'denied' });
  });

  it('is ready as soon as the connection is, whatever the reads have said: a kind that is on its way says Loading in its own row', () => {
    const { result } = mount();

    expect(state(result.current)).toEqual({ kind: 'ready' });
    expect(workloads(result.current)?.rows.map((row) => [row.id, row.status.label])).toEqual(
      ['pods', 'deployments', 'statefulsets', 'daemonsets', 'jobs', 'cronjobs'].map((id) => [id, 'Loading']),
    );
  });

  it('is ready with its view when the connection is connected, and its lane says the connection by its name', () => {
    fake.set({ connections: [{ id: 'kind-a', name: 'prod' }] });
    const { result } = mount();

    expect(result.current.source.state).toEqual({ kind: 'ready' });
    expect(result.current.scope).toEqual([{ label: 'Connection', icon: 'server', text: 'prod', role: 'connection' }]);
  });

  it('declares its lane from the first render, whatever it does not know yet: the connection\'s face says Loading while the connections are on their way', () => {
    fake.set({ connectionsPending: true });

    expect(mount().result.current.scope).toEqual([{ label: 'Connection', icon: 'server', text: 'Loading…', role: 'connection' }]);
  });
});

describe('what the page says of a cluster', () => {
  it('has the header of a connected connection: the chip, and who the cluster is, from its facts', () => {
    const { result } = mount();
    facts();

    expect(result.current.source.view?.state).toEqual({ role: 'healthy', label: 'Connected' });
    expect(result.current.source.view?.facts).toEqual([{ text: 'EKS' }, { text: 'v1.31.4' }]);
    expect(result.current.source.view?.commands).toBeUndefined();
  });

  it('says what needs attention, in the order of the mock, once the kinds have answered', () => {
    const { result } = mount();
    facts();
    answer(TROUBLE);

    expect(titles(result.current)).toEqual([
      '1 Pod in CrashLoopBackOff',
      '1 Job failed',
      '1 Node not ready',
      '1 Pod not ready',
      '1 Deployment partially ready',
      '1 PersistentVolumeClaim pending',
    ]);
    expect(attention(result.current)?.count).toBe(6);
    expect(overview(result.current).summary).toEqual([{ text: 'Needs attention', tone: 'error' }, { value: '6', label: 'failing' }]);
  });

  it('says what runs in it: a row for each kind with its status, its total and what fails', () => {
    const { result } = mount();
    facts();
    answer(TROUBLE);

    expect(workloads(result.current)?.rows.map((row) => [row.id, row.status.label, row.status.role, say(row.failing.kind === 'missing' ? undefined : row.failing.text)])).toEqual([
      ['pods', 'Needs attention', 'error', '2'],
      ['deployments', 'Needs attention', 'attention', '1'],
      ['statefulsets', 'Healthy', 'healthy', 'None failing'],
      ['daemonsets', 'Healthy', 'healthy', 'None failing'],
      ['jobs', 'Needs attention', 'error', '1'],
      ['cronjobs', 'Healthy', 'healthy', 'None failing'],
    ]);
    expect(workloads(result.current)?.rows.map((row) => (row.total.kind === 'text' ? row.total.text : '-'))).toEqual(['4', '2', '0', '0', '1', '0']);
  });

  it('says what the cluster is: the version, the Nodes that are ready, the Namespaces, and the API server', () => {
    const { result } = mount();
    facts();
    answer(TROUBLE);

    expect(clusterRow(result.current, 'version')).toBe('v1.31.4');
    expect(clusterRow(result.current, 'nodes')).toBe('3 · 2 ready');
    expect(clusterRow(result.current, 'namespaces')).toBe('12');
    expect(clusterRow(result.current, 'api-server')).toBe('https://ABC.gr7.eu-west-1.eks.amazonaws.com');
  });

  it('says Everything is running when nothing fails and every read is whole: no Needs attention section at all', () => {
    const { result } = mount();
    facts();
    answer({
      [podDefinition.type]: records(podDefinition.type, [pod('web-1', running(true))]),
      [nodeDefinition.type]: records(nodeDefinition.type, [node('node-1', 'True')]),
    });

    expect(attention(result.current)).toBeUndefined();
    expect(overview(result.current).summary).toEqual([{ text: 'Everything is running', tone: 'success' }]);
  });

  it('says Checking, and does not say everything runs, while only the first page of a kind is here: the first 256 Pods say nothing of the rest', () => {
    const { result } = mount();
    facts();
    const healthy = { metadata: { name: 'db', namespace: 'shop' }, spec: { replicas: 1 }, status: { readyReplicas: 1, availableReplicas: 1, updatedReplicas: 1 } };
    const firsts = { ...TROUBLE, [statefulSetDefinition.type]: records(statefulSetDefinition.type, [healthy]) };
    // The first pages answer and the collections do not: the first set is on screen, and says how many the kind holds.
    act(() => {
      for (const read of fake.pending((candidate) => !candidate.collection)) {
        fake.answer(read, { records: firsts[read.type] ?? [], count: { kind: 'exact', value: '5025' } });
      }
    });

    const row = (id: string) => workloads(result.current)?.rows.find((candidate) => candidate.id === id);
    expect(row('pods')).toMatchObject({ status: { role: 'error', label: 'Needs attention' }, total: { text: '5,025' }, failing: { kind: 'link', text: '2+' } });
    expect(row('statefulsets')).toMatchObject({ status: { role: 'progress', label: 'Loading' }, total: { text: '5,025' }, failing: { kind: 'text', text: 'Not checked' } });
    expect(overview(result.current).summary).toContainEqual({ status: { role: 'progress', label: 'Checking' } });
  });

  it('does not mention a kind the cluster does not serve', () => {
    fake.serve(KINDS.filter((kind) => kind.type !== jobDefinition.type));
    const { result } = mount();
    facts();
    answer(TROUBLE);

    expect(titles(result.current)).not.toContain('1 Job failed');
    expect(workloads(result.current)?.rows.map((row) => row.id)).not.toContain('jobs');
  });

  it('says that a kind cannot be listed, and offers Retry when asking again can help, which asks the read again', () => {
    const { result } = mount();
    facts();
    fail(jobDefinition.type, UNAVAILABLE);
    answer(TROUBLE);

    expect(titles(result.current)).toContain('Jobs can\'t be listed');
    const section = attention(result.current);
    expect(section?.rows.find((row) => say(row.title) === 'Jobs can\'t be listed')?.detail).toBeDefined();
    expect(section?.action).toMatchObject({ label: 'Retry' });
    expect(workloads(result.current)?.rows.find((row) => row.id === 'jobs')?.status).toEqual({ role: 'error', label: 'Read failed' });

    section?.action?.onSelect();
    expect(fake.refetch).toHaveBeenCalledTimes(1);
  });

  it('says that the user may not list a kind, with no Retry: a refusal is the same however often it is asked', () => {
    const { result } = mount();
    facts();
    fail(nodeDefinition.type, FORBIDDEN);
    answer(TROUBLE);

    const row = attention(result.current)?.rows.find((candidate) => say(candidate.title) === 'Nodes can\'t be listed');
    expect(say(row?.detail)).toBe('You don\'t have permission to list Nodes.');
    expect(attention(result.current)?.action).toBeUndefined();
    expect(clusterRow(result.current, 'nodes')).toBe('Access denied');
  });

  it('says every fact of the connection in its state: current, stale, unreadable and absent', () => {
    const { result } = mount();
    answer(TROUBLE);
    facts({
      'kubernetes.server.version': { state: 'stale', value: 'v1.35.0', observedAt: iso(4 * MINUTE) },
      'kubernetes.server': { state: 'unavailable', error: { code: 'NOT_REPORTED', message: 'The server did not report this fact.' } },
    });

    expect(clusterRow(result.current, 'version')).toBe('v1.35.0 · last read 4 min ago');
    expect(clusterRow(result.current, 'api-server')).toBe('Not reported by the server');
    expect(result.current.source.view?.facts).toEqual([]);
  });

  it('says the API groups that did not answer, when the connection says some did not', () => {
    const { result } = mount();
    facts({ ...FACTS, 'kubernetes.unavailable_api_groups': current({ count: 2, groups: [{ groupVersion: 'metrics.k8s.io/v1beta1', reason: 'x' }, { groupVersion: 'apps/v1', reason: 'x' }] }) });
    answer({});

    expect(titles(result.current)).toEqual(['2 API groups are unavailable']);
    expect(say(attention(result.current)?.rows[0]?.detail)).toBe('metrics.k8s.io/v1beta1, apps/v1');
  });

  it('says what is loading while the connection\'s facts are on their way, and why when they cannot be read at all', () => {
    const { result } = mount();
    answer(TROUBLE);
    expect(clusterRow(result.current, 'version')).toBe('Loading');

    act(() => {
      fake.set({ metadata: { supported: false, transportAvailable: false, snapshot: undefined, isLoading: false, error: undefined } });
    });
    expect(clusterRow(result.current, 'version')).toBe('Could not be read');
    expect(overview(result.current).summary).toContainEqual({ text: 'Not checked: API groups', tone: 'warning' });
  });
});

// What the runtime does with a refresh that fails: its query keeps the data of the last good read and says the failure beside it (`useResources`), so a page that is open when its control plane stops answering still holds
// every row it had, each kind with a failure beside it. Those rows are what was last seen and never what is: the page says so, and says nothing is checked that was not read.
describe('a cluster that stops answering under the open page', () => {
  it('draws what the Nodes and the Namespaces last held as not refreshed, and checks no kind whose read failed', () => {
    const { result } = mount();
    facts();
    answer(TROUBLE);
    act(() => {
      for (const read of fake.reads.filter((candidate) => candidate.collection && candidate.state === 'answered')) {
        fake.degrade(read, UNAVAILABLE);
      }
    });

    expect(clusterRow(result.current, 'nodes')).toBe('3 · 2 ready · could not be refreshed');
    expect(clusterRow(result.current, 'namespaces')).toBe('12 · could not be refreshed');
    const row = (id: string) => workloads(result.current)?.rows.find((candidate) => candidate.id === id);
    expect(row('statefulsets')).toMatchObject({ status: { label: 'Read failed' }, total: { text: '0' }, failing: { kind: 'text', text: 'Not checked' } });
    expect(row('pods')).toMatchObject({ status: { label: 'Needs attention' }, total: { text: '4' }, failing: { kind: 'link', text: '2+' } });
    expect(overview(result.current).summary).toEqual([
      { text: 'Needs attention', tone: 'error' },
      { value: '6', label: 'failing' },
      { text: 'Not checked: Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, PersistentVolumeClaims, Nodes', tone: 'warning' },
    ]);
  });

  it('draws them as the facts of the cluster they are while every read is whole: no note, and None failing', () => {
    const { result } = mount();
    facts();
    answer(TROUBLE);

    expect(clusterRow(result.current, 'nodes')).toBe('3 · 2 ready');
    expect(clusterRow(result.current, 'namespaces')).toBe('12');
    expect(workloads(result.current)?.rows.find((candidate) => candidate.id === 'statefulsets')?.failing).toEqual({ kind: 'text', text: 'None failing' });
  });
});

describe('time: a claim that waits turns into a failure with nothing changing in the data', () => {
  it('lists a claim that has been Pending for more than five minutes when the five minutes pass, and not before', () => {
    const { result } = mount();
    facts();
    answer({ [persistentVolumeClaimDefinition.type]: records(persistentVolumeClaimDefinition.type, [claim('data', 'Pending', 4 * MINUTE)]) });

    expect(attention(result.current)).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(MINUTE - 1);
    });
    expect(attention(result.current)).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(titles(result.current)).toEqual(['1 PersistentVolumeClaim pending']);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Refresh', () => {
  it('asks the collection of every kind again, and the connection\'s facts: it re-reads every source the page holds', async () => {
    const { result } = mount();
    facts();
    answer(TROUBLE);

    await act(async () => {
      await result.current.source.refresh();
    });

    expect(fake.refetch).toHaveBeenCalledTimes(9);
    expect(fake.metadataRefresh).toHaveBeenCalledTimes(1);
  });

  it('never rejects, whatever the reads do: a failure is the source\'s state', async () => {
    const { result } = mount();
    facts();
    answer(TROUBLE);
    fake.refetch.mockRejectedValueOnce(new Error('boom'));
    fake.metadataRefresh.mockRejectedValueOnce(new Error('boom'));

    await expect(act(async () => {
      await result.current.source.refresh();
    })).resolves.toBeUndefined();
  });

  it('says it refreshes while the facts of the connection are refreshed on a snapshot that is on screen, and not while the first observation runs', () => {
    const { result } = mount();
    answer(TROUBLE);

    facts({}, { refreshing: true });
    expect(result.current.source.refreshing).toBe(false);

    facts(FACTS, { refreshing: true });
    expect(result.current.source.refreshing).toBe(true);

    facts(FACTS, { refreshing: false });
    expect(result.current.source.refreshing).toBe(false);
  });
});

describe('the cost of the page', () => {
  it('opens nine collection reads on a cluster that serves what it reads, and holds no more once they have answered', () => {
    mount();
    const collections: readonly FakeRead[] = fake.reads.filter((read) => read.collection);
    expect(collections).toHaveLength(9);

    answer();
    expect(fake.reads.filter((read) => read.collection && read.observers > 0)).toHaveLength(9);
    expect(fake.reads.filter((read) => !read.collection && read.observers > 0)).toHaveLength(0);
  });
});
