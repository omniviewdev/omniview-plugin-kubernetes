import { describe, expect, it, vi } from 'vitest';

import { daemonSetRow, type DaemonSetRow } from '../kinds/daemonsets/row';
import type { KindRow } from '../kinds/definition';
import { deploymentRow, type DeploymentRow } from '../kinds/deployments/row';
import { jobRow, type JobRow } from '../kinds/jobs/row';
import { nodeRow, type NodeRow } from '../kinds/nodes/row';
import { persistentVolumeClaimRow, type PersistentVolumeClaimRow } from '../kinds/persistentvolumeclaims/row';
import { podDefinition } from '../kinds/pods/definition';
import { podRow, type PodRow } from '../kinds/pods/row';
import { statefulSetRow } from '../kinds/statefulsets/row';
import { statusOf } from '../kinds/status';
import { hostRecord } from '../kinds/testing';
import type { KindView } from '../kinds/useKindRows';

import { STUCK_AFTER_MS, claimRule, daemonSetRule, jobRule, nextStuck, nodeRule, observe, podRule, workloadRule } from './assess';

// What the cluster overview counts as failing, kind by kind, and what it says of one kind's read. The state words and their roles are the kinds' own (`kinds/status.ts`, `kinds/workload.ts`, each `row.ts`): a rule
// reads a row's status and nothing else it could word again, so the overview and the lists never disagree about what a Pod or a Deployment is. The rules are the mock's `assess` (k8s-cluster.js:194-223).

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const MINUTE = 60_000;

const base: KindRow = { key: 'k', name: 'cart-api', namespace: 'shop', nameTail: 0, createdAt: NOW - 60 * MINUTE };
const pod = (over: Partial<PodRow> = {}): PodRow => ({ ...base, ready: { ready: 1, total: 1 }, status: statusOf('Running'), restarts: 0, node: 'node-1', ip: '10.0.0.1', ...over });
const job = (over: Partial<JobRow> = {}): JobRow => ({ ...base, completions: { ready: 0, total: 1 }, startedAt: undefined, finishedAt: undefined, status: statusOf('Running'), ...over });
const node = (over: Partial<NodeRow> = {}): NodeRow => ({ ...base, namespace: '', status: statusOf('Ready'), version: 'v1.31.4', address: '10.0.0.9', ...over });
const claim = (over: Partial<PersistentVolumeClaimRow> = {}): PersistentVolumeClaimRow => ({ ...base, status: statusOf('Pending'), volume: undefined, capacity: undefined, storageClass: undefined, ...over });
const deployment = (over: Partial<DeploymentRow> = {}): DeploymentRow => ({ ...base, ready: { ready: 3, total: 3 }, updated: 3, status: statusOf('Available'), ...over });
const daemonSet = (over: Partial<DaemonSetRow> = {}): DaemonSetRow => ({ ...base, desired: 3, ready: 3, updated: 3, status: statusOf('Available'), ...over });

describe('the Pods rule: the status word\'s role, and a Pod that runs and is not ready', () => {
  it.each([
    ['CrashLoopBackOff', 'error'],
    ['Error', 'error'],
    ['ImagePullBackOff', 'error'],
    ['OOMKilled', 'error'],
    ['Init:Error', 'error'],
    ['ExitCode:137', 'error'],
    ['Unknown', 'attention'],
  ] as const)('fails a Pod that says %s, in the role the table gives the word (%s)', (word, role) => {
    expect(podRule(pod({ status: statusOf(word) }), NOW)).toEqual({ word, role });
  });

  it.each(['Pending', 'ContainerCreating', 'Terminating', 'Completed', 'Succeeded', 'Init:0/1'])('does not fail a Pod that says %s, whether or not its containers are ready (they are not, yet)', (word) => {
    expect(podRule(pod({ status: statusOf(word), ready: { ready: 0, total: 1 } }), NOW)).toBeUndefined();
  });

  it('calls a Pod that is Running and has containers that are not ready Not ready, in the attention role (the word is the overview\'s: the table has none for it)', () => {
    expect(podRule(pod({ ready: { ready: 1, total: 2 } }), NOW)).toEqual({ word: 'Not ready', role: 'attention' });
    expect(podRule(pod({ ready: { ready: 0, total: 1 } }), NOW)).toEqual({ word: 'Not ready', role: 'attention' });
  });

  it('does not fail a Pod that is Running with every container ready, or that lists no containers, or that says no state', () => {
    expect(podRule(pod({ ready: { ready: 2, total: 2 } }), NOW)).toBeUndefined();
    expect(podRule(pod({ ready: undefined }), NOW)).toBeUndefined();
    expect(podRule(pod({ ready: { ready: 0, total: 0 } }), NOW)).toBeUndefined();
    expect(podRule(pod({ status: undefined, ready: { ready: 0, total: 1 } }), NOW)).toBeUndefined();
  });

  it('says how many times a failing Pod restarted, when it did: `1 restart`, `3 restarts`', () => {
    expect(podRule(pod({ status: statusOf('CrashLoopBackOff'), restarts: 3 }), NOW)).toMatchObject({ extra: '3 restarts' });
    expect(podRule(pod({ status: statusOf('CrashLoopBackOff'), restarts: 1 }), NOW)).toMatchObject({ extra: '1 restart' });
    expect(podRule(pod({ status: statusOf('CrashLoopBackOff'), restarts: 0 }), NOW)).not.toHaveProperty('extra');
    expect(podRule(pod({ status: statusOf('CrashLoopBackOff'), restarts: undefined }), NOW)).not.toHaveProperty('extra');
  });
});

describe('the Jobs rule: a Job that failed', () => {
  it('fails a Job whose state is Failed, an error', () => {
    expect(jobRule(job({ status: statusOf('Failed') }), NOW)).toEqual({ word: 'Failed', role: 'error' });
  });

  it.each(['Running', 'Complete', 'Suspended', 'Terminating', 'FailureTarget', 'SuccessCriteriaMet'])('does not fail a Job that says %s', (word) => {
    expect(jobRule(job({ status: statusOf(word) }), NOW)).toBeUndefined();
  });

  it('says nothing of a Job that says no state', () => {
    expect(jobRule(job({ status: undefined }), NOW)).toBeUndefined();
  });
});

describe('the Nodes rule: a Node that is not Ready', () => {
  it('fails a Node that is NotReady (an error) or whose Ready condition nobody reported, Unknown (attention)', () => {
    expect(nodeRule(node({ status: statusOf('NotReady') }), NOW)).toEqual({ word: 'NotReady', role: 'error' });
    expect(nodeRule(node({ status: statusOf('Unknown') }), NOW)).toEqual({ word: 'Unknown', role: 'attention' });
  });

  it('does not fail a Node that is Ready, or cordoned: Scheduling disabled is a choice, not a failure', () => {
    expect(nodeRule(node({ status: statusOf('Ready') }), NOW)).toBeUndefined();
    expect(nodeRule(node({ status: statusOf('Scheduling disabled') }), NOW)).toBeUndefined();
    expect(nodeRule(node({ status: undefined }), NOW)).toBeUndefined();
  });
});

describe('the rule of a Deployment or a StatefulSet: the word of the counts (`workloadState`), and how many are ready', () => {
  it('fails one that is Unavailable (an error) or Partially ready (attention), and says N of M ready', () => {
    expect(workloadRule(deployment({ ready: { ready: 0, total: 3 }, status: statusOf('Unavailable') }), NOW)).toEqual({ word: 'Unavailable', role: 'error', extra: '0 of 3 ready' });
    expect(workloadRule(deployment({ ready: { ready: 1, total: 3 }, status: statusOf('Partially ready') }), NOW)).toEqual({ word: 'Partially ready', role: 'attention', extra: '1 of 3 ready' });
  });

  it.each(['Available', 'Progressing', 'Scaled to zero', 'Paused'])('does not fail one that says %s: a rollout in progress, a choice to pause or to scale down, and a healthy one are not failures', (word) => {
    expect(workloadRule(deployment({ status: statusOf(word) }), NOW)).toBeUndefined();
  });

  it('says nothing of one that says no state: it did not state its counts, and none is made up', () => {
    expect(workloadRule(deployment({ ready: undefined, status: undefined }), NOW)).toBeUndefined();
  });

  it('says what it can of a failing one that states no ready count: the word alone', () => {
    expect(workloadRule(deployment({ ready: undefined, status: statusOf('Unavailable') }), NOW)).toEqual({ word: 'Unavailable', role: 'error' });
  });
});

describe('the DaemonSets rule: the same word, with the nodes it wants as the total', () => {
  it('fails one that is Unavailable or Partially ready, and says N of M ready', () => {
    expect(daemonSetRule(daemonSet({ desired: 4, ready: 0, status: statusOf('Unavailable') }), NOW)).toEqual({ word: 'Unavailable', role: 'error', extra: '0 of 4 ready' });
    expect(daemonSetRule(daemonSet({ desired: 4, ready: 3, status: statusOf('Partially ready') }), NOW)).toEqual({ word: 'Partially ready', role: 'attention', extra: '3 of 4 ready' });
  });

  it('does not fail one that is Available, or that says nothing', () => {
    expect(daemonSetRule(daemonSet(), NOW)).toBeUndefined();
    expect(daemonSetRule(daemonSet({ desired: undefined, ready: undefined, status: undefined }), NOW)).toBeUndefined();
  });
});

describe('the PersistentVolumeClaims rule: a claim that is Lost, or has been Pending for more than five minutes', () => {
  it('fails a claim that has waited for a volume for more than five minutes, in the attention role (it is no longer on its way), and says what it waits for', () => {
    expect(claimRule(claim({ createdAt: NOW - 6 * MINUTE }), NOW)).toEqual({ word: 'Pending', role: 'attention', extra: 'waiting for a volume' });
  });

  it('does not fail a claim that has waited five minutes or less: Pending is a state in motion', () => {
    expect(claimRule(claim({ createdAt: NOW - 5 * MINUTE }), NOW)).toBeUndefined();
    expect(claimRule(claim({ createdAt: NOW - MINUTE }), NOW)).toBeUndefined();
    expect(claimRule(claim({ createdAt: NOW - 5 * MINUTE - 1 }), NOW)).toMatchObject({ word: 'Pending' });
  });

  it('does not say a claim that does not say when it was made has waited: its age is not known', () => {
    expect(claimRule(claim({ createdAt: undefined }), NOW)).toBeUndefined();
  });

  it('fails a claim that is Lost, an error, however young it is', () => {
    expect(claimRule(claim({ status: statusOf('Lost'), createdAt: NOW - MINUTE }), NOW)).toEqual({ word: 'Lost', role: 'error' });
  });

  it('does not fail a claim that is Bound, or Terminating', () => {
    expect(claimRule(claim({ status: statusOf('Bound') }), NOW)).toBeUndefined();
    expect(claimRule(claim({ status: statusOf('Terminating'), createdAt: NOW - 60 * MINUTE }), NOW)).toBeUndefined();
  });

  it('is five minutes, as the mock has it (k8s-cluster.js:213)', () => {
    expect(STUCK_AFTER_MS).toBe(300_000);
  });
});

describe('nextStuck: when the overview next has to look again, with no change in the data', () => {
  it('is the first instant at which the claim that is Pending and fails soonest will be failing: when it has waited more than five minutes', () => {
    const rows = [claim({ createdAt: NOW - 2 * MINUTE }), claim({ createdAt: NOW - 4 * MINUTE }), claim({ status: statusOf('Bound'), createdAt: NOW - MINUTE })];
    const turns = nextStuck(rows, NOW);

    expect(turns).toBe(NOW - 4 * MINUTE + STUCK_AFTER_MS + 1);
    expect(claimRule(rows[1] as PersistentVolumeClaimRow, (turns ?? 0) - 1)).toBeUndefined();
    expect(claimRule(rows[1] as PersistentVolumeClaimRow, turns ?? 0)).toMatchObject({ word: 'Pending' });
  });

  it('is nothing when no claim is Pending and young: one that is failing already is on the page, and the others will not change with time', () => {
    expect(nextStuck([claim({ createdAt: NOW - 6 * MINUTE })], NOW)).toBeUndefined();
    expect(nextStuck([claim({ status: statusOf('Bound') })], NOW)).toBeUndefined();
    expect(nextStuck([claim({ createdAt: undefined })], NOW)).toBeUndefined();
    expect(nextStuck([], NOW)).toBeUndefined();
  });

  it('is the next millisecond for a claim that has waited exactly five minutes: the rule says more than five', () => {
    expect(nextStuck([claim({ createdAt: NOW - 5 * MINUTE })], NOW)).toBe(NOW + 1);
  });
});

// The rules over the rows the kinds make of the objects a cluster serves: a rule that read a field its row does not hold would pass above and fail here.
describe('the rules over real rows: the objects a cluster serves, through the kinds\' own row models', () => {
  const record = (object: unknown, type: string) => hostRecord(object, `row:${Math.random()}`, type);
  const meta = (name: string, over: Record<string, unknown> = {}) => ({ name, namespace: 'shop', creationTimestamp: new Date(NOW - 10 * MINUTE).toISOString(), ...over });

  it('fails a Pod whose container waits in CrashLoopBackOff, and counts its restarts', () => {
    const row = podRow(record({
      metadata: meta('api-1'),
      spec: { containers: [{ name: 'app' }] },
      status: { phase: 'Running', containerStatuses: [{ name: 'app', ready: false, restartCount: 5, state: { waiting: { reason: 'CrashLoopBackOff' } } }] },
    }, '/pods'));

    expect(podRule(row, NOW)).toEqual({ word: 'CrashLoopBackOff', role: 'error', extra: '5 restarts' });
  });

  it('fails a Pod that runs and has a container that is not ready, and not one whose containers all are', () => {
    const running = (ready: boolean) => podRow(record({
      metadata: meta('api-2'),
      spec: { containers: [{ name: 'app' }] },
      status: { phase: 'Running', conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }], containerStatuses: [{ name: 'app', ready, restartCount: 0, state: { running: {} } }] },
    }, '/pods'));

    expect(podRule(running(false), NOW)).toEqual({ word: 'Not ready', role: 'attention' });
    expect(podRule(running(true), NOW)).toBeUndefined();
  });

  it('fails a Deployment with fewer replicas ready than it wants, and one with none ready, and not one that is Available', () => {
    const rowOf = (replicas: number, ready: number) => deploymentRow(record({ metadata: meta('api'), spec: { replicas }, status: { readyReplicas: ready, availableReplicas: ready, updatedReplicas: replicas } }, 'apps/deployments'));

    expect(workloadRule(rowOf(3, 1), NOW)).toEqual({ word: 'Partially ready', role: 'attention', extra: '1 of 3 ready' });
    expect(workloadRule(rowOf(3, 0), NOW)).toEqual({ word: 'Unavailable', role: 'error', extra: '0 of 3 ready' });
    expect(workloadRule(rowOf(3, 3), NOW)).toBeUndefined();
  });

  it('fails a StatefulSet and a DaemonSet the same way', () => {
    const set = statefulSetRow(record({ metadata: meta('db'), spec: { replicas: 3 }, status: { readyReplicas: 2, availableReplicas: 2, updatedReplicas: 3 } }, 'apps/statefulsets'));
    const daemons = daemonSetRow(record({ metadata: meta('agent'), status: { desiredNumberScheduled: 4, numberReady: 1, numberAvailable: 1, updatedNumberScheduled: 4 } }, 'apps/daemonsets'));

    expect(workloadRule(set, NOW)).toEqual({ word: 'Partially ready', role: 'attention', extra: '2 of 3 ready' });
    expect(daemonSetRule(daemons, NOW)).toEqual({ word: 'Partially ready', role: 'attention', extra: '1 of 4 ready' });
  });

  it('fails a Job that has a Failed condition', () => {
    const failed = jobRow(record({ metadata: meta('batch-1'), spec: { completions: 1 }, status: { failed: 1, conditions: [{ type: 'Failed', status: 'True' }] } }, 'batch/jobs'));

    expect(jobRule(failed, NOW)).toEqual({ word: 'Failed', role: 'error' });
  });

  it('fails a Node that is not Ready', () => {
    const down = nodeRow(record({ metadata: { name: 'node-2' }, status: { conditions: [{ type: 'Ready', status: 'False' }] } }, '/nodes'));

    expect(nodeRule(down, NOW)).toEqual({ word: 'NotReady', role: 'error' });
  });

  it('fails a claim that has been Pending for ten minutes, and not one made a minute ago', () => {
    const pending = (age: number) => persistentVolumeClaimRow(record({ metadata: meta('data', { creationTimestamp: new Date(NOW - age).toISOString() }), status: { phase: 'Pending' } }, '/persistentvolumeclaims'));

    expect(claimRule(pending(10 * MINUTE), NOW)).toEqual({ word: 'Pending', role: 'attention', extra: 'waiting for a volume' });
    expect(claimRule(pending(MINUTE), NOW)).toBeUndefined();
  });
});

type PodsView = KindView<PodRow>;

/** A view as `useKindRows` hands it over: the rows, the whole set, and what each test changes. */
function view(rows: readonly PodRow[], over: Partial<PodsView> = {}): PodsView {
  return {
    state: rows.length > 0 ? { kind: 'loaded' } : { kind: 'empty' },
    failure: undefined,
    rows,
    loaded: rows.length,
    complete: true,
    count: { kind: 'exact', value: String(rows.length) },
    live: true,
    refreshing: false,
    namespaced: true,
    connect: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    ...over,
  };
}

const observePods = (pods: PodsView) => observe(podDefinition, pods, podRule, NOW);

describe('observe: what one kind\'s read says', () => {
  it('names the kind it is about, and says it is served', () => {
    const observation = observePods(view([pod()]));

    expect(observation.kind).toBe(podDefinition);
    expect(observation.served).toBe(true);
  });

  it('says every object that fails, in the order of the rows, with its name and namespace, its word, its role and what more is known of it', () => {
    const rows = [
      pod({ name: 'api-1', namespace: 'shop', status: statusOf('CrashLoopBackOff'), restarts: 4 }),
      pod({ name: 'api-2', namespace: 'shop' }),
      pod({ name: 'web-1', namespace: 'edge', ready: { ready: 0, total: 1 } }),
    ];
    const { failing } = observePods(view(rows));

    expect(failing).toEqual([
      { name: 'api-1', namespace: 'shop', word: 'CrashLoopBackOff', role: 'error', extra: '4 restarts' },
      { name: 'web-1', namespace: 'edge', word: 'Not ready', role: 'attention', extra: undefined },
    ]);
  });

  it('counts the objects that are here and whether they are all of them', () => {
    const rows = [pod(), pod({ name: 'b' })];

    expect(observePods(view(rows))).toMatchObject({ loaded: 2, complete: true, said: undefined, problem: undefined });
  });

  it('says what the first page says the kind holds while the set is not complete, and nothing once it is', () => {
    const rows = [pod()];
    const first = { kind: 'estimate', value: '5000' } as const;

    expect(observePods(view(rows, { complete: false, firstCount: first }))).toMatchObject({ loaded: 1, complete: false, said: first });
    expect(observePods(view(rows, { complete: true, firstCount: first }))).toMatchObject({ complete: true, said: undefined });
  });

  it('is a kind that is not served when the cluster does not serve the type: there is nothing to say of it', () => {
    expect(observePods(view([], { state: { kind: 'unsupported' }, complete: false }))).toMatchObject({ served: false, problem: undefined, failing: [] });
  });

  it('is on its way while the read has not answered: no rows, not complete, and no problem', () => {
    for (const state of [{ kind: 'connecting' }, { kind: 'disconnected' }, { kind: 'loading' }] as const) {
      expect(observePods(view([], { state, complete: false }))).toMatchObject({ served: true, loaded: 0, complete: false, problem: undefined });
    }
  });

  it('is whole and empty when the complete set holds no object', () => {
    expect(observePods(view([]))).toMatchObject({ served: true, loaded: 0, complete: true, problem: undefined, failing: [] });
  });

  it('has no failing object for a kind that has no rule: it counts its objects and says nothing of what fails', () => {
    const observation = observe(podDefinition, view([pod({ status: statusOf('CrashLoopBackOff') })]), undefined, NOW);

    expect(observation.failing).toEqual([]);
    expect(observation.loaded).toBe(1);
  });

  it('judges the rows by the instant it is given, so that a claim turns failing as time goes by', () => {
    const young = claim({ createdAt: NOW - 4 * MINUTE });
    const claims = (now: number) => observe(podDefinition, view([young] as never) as never, claimRule as never, now);

    expect(claims(NOW).failing).toEqual([]);
    expect(claims(NOW + 2 * MINUTE).failing).toHaveLength(1);
  });
});

describe('observe: a read that did not give the objects', () => {
  it('says the user may not list the kind, in the overview\'s own words, with nothing to ask again: the refusal cannot change', () => {
    const { problem } = observePods(view([], { state: { kind: 'denied', message: 'Forbidden.' }, complete: false }));

    expect(problem).toEqual({ denied: true, cause: 'You don\'t have permission to list Pods.', retry: undefined });
  });

  it('says it is the same refusal when it came after the rows were shown: the rows are kept, and so is the refusal', () => {
    const { problem, failing } = observePods(view([pod({ status: statusOf('Error') })], { failure: { kind: 'denied' } }));

    expect(problem).toMatchObject({ denied: true, cause: 'You don\'t have permission to list Pods.' });
    expect(failing).toHaveLength(1);
  });

  it('says why a read failed in the words the lists say, and asks again through the view\'s own retry', () => {
    const retry = vi.fn(async () => undefined);
    const { problem } = observePods(view([], { state: { kind: 'unreachable' }, complete: false, retry }));

    expect(problem).toMatchObject({ denied: false, cause: 'The cluster did not answer.' });
    void problem?.retry?.();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('says what the runtime said of a read that failed for another reason, and the plugin\'s own sentence when it said nothing', () => {
    expect(observePods(view([], { state: { kind: 'failed', message: 'etcdserver: request timed out' }, complete: false })).problem).toMatchObject({ cause: 'etcdserver: request timed out' });
    expect(observePods(view([], { state: { kind: 'failed' }, complete: false })).problem).toMatchObject({ cause: 'Pods could not be read.' });
    expect(observePods(view([], { state: { kind: 'needs-sign-in' }, complete: false })).problem).toMatchObject({ cause: 'The connection needs you to sign in.' });
  });

  it('keeps the rows beside a failure that came after them, and says the failure', () => {
    const { problem, loaded, failing } = observePods(view([pod({ status: statusOf('Error') })], { failure: { kind: 'unreachable', message: 'Lost the cluster.' }, complete: false }));

    expect(problem).toMatchObject({ denied: false, cause: 'Lost the cluster.' });
    expect(loaded).toBe(1);
    expect(failing).toHaveLength(1);
  });

  it('offers no way to ask again where asking cannot help: a connection that is gone', () => {
    expect(observePods(view([], { state: { kind: 'not-found' }, complete: false })).problem).toMatchObject({ retry: undefined });
  });
});
