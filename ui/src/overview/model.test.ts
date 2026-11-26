import { describe, expect, it, vi } from 'vitest';

import { cronJobDefinition } from '../kinds/cronjobs/definition';
import { daemonSetDefinition } from '../kinds/daemonsets/definition';
import { deploymentDefinition } from '../kinds/deployments/definition';
import { jobDefinition } from '../kinds/jobs/definition';
import { namespaceDefinition } from '../kinds/namespaces/definition';
import { nodeDefinition } from '../kinds/nodes/definition';
import { persistentVolumeClaimDefinition } from '../kinds/persistentvolumeclaims/definition';
import { podDefinition } from '../kinds/pods/definition';
import { statefulSetDefinition } from '../kinds/statefulsets/definition';

import type { Failing, KindWords, Observation, Problem } from './assess';
import type { Fact, Facts } from './facts';
import { overviewModel, type Inputs, type OverviewModel } from './model';

// The overview as plain data: what each section says, from what each kind's read says (`assess.ts`) and what the connection's facts say (`facts.ts`). Nothing here draws or reads: a function of its inputs, so that every
// state the page can be in is a case below. The five questions of the mock's page (k8s-cluster.js:1-13): what needs attention, what runs in it, what the cluster is, how loaded it is and what changed; the last two
// are not here (no metrics are served to the UI, and the plugin has no Events kind), and the page says nothing of them.

/** A kind's read that is whole and holds three objects, none failing. Each case says what differs. */
const observation = (kind: KindWords, over: Partial<Observation> = {}): Observation => ({ kind, served: true, loaded: 3, complete: true, said: undefined, problem: undefined, failing: [], ...over });

const failingOf = (name: string, word: string, role: 'error' | 'attention', over: Partial<Failing> = {}): Failing => ({ name, namespace: 'shop', word, role, extra: undefined, ...over });

const problem = (cause: string, over: Partial<Problem> = {}): Problem => ({ denied: false, cause, retry: vi.fn(async () => undefined), ...over });
const denied = (kind: KindWords): Problem => ({ denied: true, cause: `You don't have permission to list ${kind.nouns.other}.`, retry: undefined });

const current = (value: string): Fact => ({ state: 'current', value });
const FACTS: Facts = {
  version: current('v1.35.0'),
  url: current('https://10.0.0.1:6443'),
  platform: current('kind'),
  distribution: { state: 'absent' },
  groups: { state: 'absent' },
};

function inputs(over: Partial<Inputs> = {}): Inputs {
  return {
    pods: observation(podDefinition),
    deployments: observation(deploymentDefinition),
    statefulSets: observation(statefulSetDefinition),
    daemonSets: observation(daemonSetDefinition),
    jobs: observation(jobDefinition),
    cronJobs: observation(cronJobDefinition),
    claims: observation(persistentVolumeClaimDefinition),
    nodes: observation(nodeDefinition),
    namespaces: observation(namespaceDefinition),
    nodesReady: 3,
    facts: FACTS,
    ...over,
  };
}

const model = (over: Partial<Inputs> = {}): OverviewModel => overviewModel(inputs(over));
const titles = (over: Partial<Inputs> = {}) => model(over).attention?.rows.map((row) => row.title);
const factsWith = (over: Partial<Facts>): Facts => ({ ...FACTS, ...over });

describe('the header: the state of the connection, and who it is', () => {
  it('says the connection is Connected, in the healthy role: the page is only drawn for a connection that is', () => {
    expect(model().state).toEqual({ role: 'healthy', label: 'Connected' });
  });

  it('says the platform, and the server\'s version, in the words a person reads: no command of its own', () => {
    expect(model({ facts: factsWith({ platform: current('eks'), distribution: current('eks'), version: current('v1.31.4-eks-aeac579') }) }).facts).toEqual([{ text: 'EKS' }, { text: 'v1.31.4' }]);
    expect(model().facts).toEqual([{ text: 'kind' }, { text: 'v1.35.0' }]);
  });

  it('says the distribution too when it is not the platform: k3s in kind', () => {
    expect(model({ facts: factsWith({ platform: current('kind'), distribution: current('k3s') }) }).facts).toEqual([{ text: 'kind' }, { text: 'k3s' }, { text: 'v1.35.0' }]);
  });

  it('says the distribution when there is no platform, and nothing it does not know', () => {
    expect(model({ facts: factsWith({ platform: { state: 'absent' }, distribution: current('openshift') }) }).facts).toEqual([{ text: 'OpenShift' }, { text: 'v1.35.0' }]);
    expect(model({ facts: factsWith({ platform: { state: 'absent' }, version: { state: 'absent' } }) }).facts).toEqual([]);
  });

  it('says a fact that is current and no other: the header is the cluster\'s identity, and a stale one would draw as current (the Cluster section says it is stale)', () => {
    const stale: Fact = { state: 'stale', value: 'v1.35.0', observedAt: 1 };
    expect(model({ facts: factsWith({ version: stale, platform: stale }) }).facts).toEqual([]);
    expect(model({ facts: factsWith({ version: { state: 'loading' }, platform: { state: 'unreadable', code: 'X' } }) }).facts).toEqual([]);
  });

  it('says a fact that is not a word of its kind as nothing: a version that is not text', () => {
    expect(model({ facts: factsWith({ version: current(3 as never), platform: current({} as never) }) }).facts).toEqual([]);
  });
});

describe('Needs attention: one row for the objects of a kind that fail in one way, as the mock\'s `attentionRow` words it', () => {
  it('is not drawn when nothing fails and every read is whole: a section with nothing to say is not drawn', () => {
    expect(model().attention).toBeUndefined();
  });

  it('says how many objects of the kind fail and how: `3 Pods in CrashLoopBackOff`, `2 Deployments partially ready`, `1 Pod with an error`', () => {
    const pods = observation(podDefinition, { failing: [failingOf('a', 'CrashLoopBackOff', 'error'), failingOf('b', 'CrashLoopBackOff', 'error'), failingOf('c', 'CrashLoopBackOff', 'error'), failingOf('d', 'Error', 'error')] });
    const deployments = observation(deploymentDefinition, { failing: [failingOf('x', 'Partially ready', 'attention'), failingOf('y', 'Partially ready', 'attention')] });

    expect(titles({ pods, deployments })).toEqual(['3 Pods in CrashLoopBackOff', '1 Pod with an error', '2 Deployments partially ready']);
  });

  it.each<['nodes' | 'jobs' | 'claims' | 'statefulSets' | 'pods', KindWords, Failing, string]>([
    ['nodes', nodeDefinition, failingOf('n1', 'NotReady', 'error', { namespace: '' }), '1 Node not ready'],
    ['nodes', nodeDefinition, failingOf('n1', 'Unknown', 'attention', { namespace: '' }), '1 Node unknown'],
    ['jobs', jobDefinition, failingOf('j', 'Failed', 'error'), '1 Job failed'],
    ['claims', persistentVolumeClaimDefinition, failingOf('c', 'Pending', 'attention'), '1 PersistentVolumeClaim pending'],
    ['pods', podDefinition, failingOf('p', 'Not ready', 'attention'), '1 Pod not ready'],
    ['pods', podDefinition, failingOf('p', 'OOMKilled', 'error'), '1 Pod in OOMKilled'],
    ['pods', podDefinition, failingOf('p', 'Init:Error', 'error'), '1 Pod in Init:Error'],
    ['statefulSets', statefulSetDefinition, failingOf('s', 'Unavailable', 'error'), '1 StatefulSet unavailable'],
  ])('words the %s that fail with %s as %s: a word the platform spells as a name is `in <name>`, and the rest read as a phrase', (key, kind, failing, title) => {
    expect(titles({ [key]: observation(kind, { failing: [failing] }) })).toEqual([title]);
  });

  it('says the first names of the objects under the title: `api-1, api-2 and 3 more`', () => {
    const failing = ['api-1', 'api-2', 'api-3', 'api-4', 'api-5'].map((name) => failingOf(name, 'CrashLoopBackOff', 'error'));

    expect(model({ pods: observation(podDefinition, { failing }) }).attention?.rows[0]?.detail).toEqual({ text: 'api-1, api-2 and 3 more' });
  });

  it('says two names as they are, with no "and 0 more"', () => {
    const failing = ['api-1', 'api-2'].map((name) => failingOf(name, 'CrashLoopBackOff', 'error'));

    expect(model({ pods: observation(podDefinition, { failing }) }).attention?.rows[0]?.detail).toEqual({ text: 'api-1, api-2' });
  });

  it('says one object by its name, its namespace and what more is known of it: `api-1 · shop · 3 restarts`', () => {
    const one = (failing: Failing) => model({ pods: observation(podDefinition, { failing: [failing] }) }).attention?.rows[0]?.detail;

    expect(one(failingOf('api-1', 'CrashLoopBackOff', 'error', { extra: '3 restarts' }))).toEqual({ text: 'api-1 · shop · 3 restarts' });
    expect(one(failingOf('api-1', 'CrashLoopBackOff', 'error'))).toEqual({ text: 'api-1 · shop' });
    expect(model({ nodes: observation(nodeDefinition, { failing: [failingOf('n1', 'NotReady', 'error', { namespace: '' })] }) }).attention?.rows[0]?.detail).toEqual({ text: 'n1' });
  });

  it('links the title to the kind\'s list, unfiltered: the lists have no filter a route can name', () => {
    const failing = ['a', 'b'].map((name) => failingOf(name, 'CrashLoopBackOff', 'error'));

    expect(model({ pods: observation(podDefinition, { failing }) }).attention?.rows[0]?.to).toEqual({ page: 'pods' });
  });

  it('links one object to its own page when the plugin has one, as the mock opens it, and to the list when it has none: no link goes nowhere', () => {
    const pod = model({ pods: observation(podDefinition, { failing: [failingOf('api-1', 'Error', 'error')] }) }).attention?.rows[0]?.to;
    const node = model({ nodes: observation(nodeDefinition, { failing: [failingOf('n1', 'NotReady', 'error', { namespace: '' })] }) }).attention?.rows[0]?.to;
    const claim = model({ claims: observation(persistentVolumeClaimDefinition, { failing: [failingOf('data', 'Pending', 'attention')] }) }).attention?.rows[0]?.to;

    expect(pod).toEqual({ page: 'pod', params: { namespace: 'shop', name: 'api-1' } });
    expect(node).toEqual({ page: 'node', params: { name: 'n1' } });
    expect(claim).toEqual({ page: 'persistentvolumeclaims' });
  });

  it('puts the errors first, then the kinds in the order of the mock\'s rank (Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, claims, Nodes), and the words of one kind in the order they were first seen', () => {
    const rows = model({
      pods: observation(podDefinition, { failing: [failingOf('p1', 'Not ready', 'attention'), failingOf('p2', 'CrashLoopBackOff', 'error'), failingOf('p3', 'Unknown', 'attention')] }),
      deployments: observation(deploymentDefinition, { failing: [failingOf('d1', 'Partially ready', 'attention')] }),
      jobs: observation(jobDefinition, { failing: [failingOf('j1', 'Failed', 'error')] }),
      claims: observation(persistentVolumeClaimDefinition, { failing: [failingOf('c1', 'Pending', 'attention')] }),
      nodes: observation(nodeDefinition, { failing: [failingOf('n1', 'NotReady', 'error', { namespace: '' })] }),
    }).attention?.rows;

    expect(rows?.map((row) => [row.severity, row.title])).toEqual([
      ['error', '1 Pod in CrashLoopBackOff'],
      ['error', '1 Job failed'],
      ['error', '1 Node not ready'],
      ['attention', '1 Pod not ready'],
      ['attention', '1 Pod unknown'],
      ['attention', '1 Deployment partially ready'],
      ['attention', '1 PersistentVolumeClaim pending'],
    ]);
  });

  it('counts the objects that fail, not the rows', () => {
    const failing = ['a', 'b', 'c'].map((name) => failingOf(name, 'CrashLoopBackOff', 'error'));
    const jobs = observation(jobDefinition, { failing: [failingOf('j', 'Failed', 'error')] });

    expect(model({ pods: observation(podDefinition, { failing }), jobs }).attention?.count).toBe(4);
  });

  it('keys each row by its kind and its word, so that a row keeps its place while others come and go', () => {
    const pods = observation(podDefinition, { failing: [failingOf('a', 'CrashLoopBackOff', 'error'), failingOf('b', 'Error', 'error')] });

    expect(model({ pods }).attention?.rows.map((row) => row.id)).toEqual(['pods:CrashLoopBackOff', 'pods:Error']);
  });

  it('says nothing of a kind that is not served, and nothing of one that is on its way', () => {
    const gone = observation(deploymentDefinition, { served: false, loaded: 0, failing: [] });
    const loading = observation(jobDefinition, { loaded: 0, complete: false });

    expect(model({ deployments: gone, jobs: loading }).attention).toBeUndefined();
  });
});

describe('Needs attention: a kind that cannot be listed', () => {
  it('is one row for the kind, `<Kinds> can\'t be listed`, with the cause under it: the words of the failure', () => {
    const pods = observation(podDefinition, { loaded: 0, complete: false, problem: problem('The cluster did not answer.') });

    expect(model({ pods }).attention?.rows).toEqual([
      { id: 'pods:unreadable', severity: 'attention', title: 'Pods can\'t be listed', detail: { text: 'The cluster did not answer.' }, to: undefined },
    ]);
  });

  it('says in the plugin\'s own words that the user may not list the kind', () => {
    const jobs = observation(jobDefinition, { loaded: 0, complete: false, problem: denied(jobDefinition) });

    expect(model({ jobs }).attention?.rows[0]).toMatchObject({ title: 'Jobs can\'t be listed', detail: { text: 'You don\'t have permission to list Jobs.' } });
  });

  it('is after the objects that fail, one row for each kind that cannot be listed, in the order of the rank', () => {
    const nodes = observation(nodeDefinition, { loaded: 0, complete: false, problem: problem('The cluster did not answer.') });
    const pods = observation(podDefinition, { loaded: 0, complete: false, problem: denied(podDefinition) });
    const jobs = observation(jobDefinition, { failing: [failingOf('j', 'Failed', 'error')] });

    expect(titles({ nodes, pods, jobs })).toEqual(['1 Job failed', 'Pods can\'t be listed', 'Nodes can\'t be listed']);
  });

  it('keeps the objects it has read beside a read that failed after them: both are said', () => {
    const pods = observation(podDefinition, { complete: false, problem: problem('Lost the cluster.'), failing: [failingOf('a', 'Error', 'error')] });

    expect(titles({ pods })).toEqual(['1 Pod with an error', 'Pods can\'t be listed']);
    expect(model({ pods }).attention?.count).toBe(1);
  });

  it('is no count when no object fails: the rows say what they say, and no zero is made up', () => {
    const pods = observation(podDefinition, { loaded: 0, complete: false, problem: denied(podDefinition) });

    expect(model({ pods }).attention?.count).toBeUndefined();
  });

  it('says nothing of a kind that is not served, whatever it holds', () => {
    const pods = observation(podDefinition, { served: false, loaded: 0, complete: false, problem: problem('x') });

    expect(model({ pods }).attention).toBeUndefined();
  });

  it('offers Retry when a read that failed can be asked again, and asks every one of them', () => {
    const podsRetry = vi.fn(async () => undefined);
    const nodesRetry = vi.fn(async () => undefined);
    const deniedJobs = observation(jobDefinition, { loaded: 0, complete: false, problem: denied(jobDefinition) });
    const pods = observation(podDefinition, { loaded: 0, complete: false, problem: problem('The cluster did not answer.', { retry: podsRetry }) });
    const nodes = observation(nodeDefinition, { loaded: 0, complete: false, problem: problem('The cluster did not answer.', { retry: nodesRetry }) });

    const { retry } = model({ pods, nodes, jobs: deniedJobs }).attention ?? {};
    expect(retry).toBeDefined();
    retry?.();
    expect(podsRetry).toHaveBeenCalledTimes(1);
    expect(nodesRetry).toHaveBeenCalledTimes(1);
  });

  it('offers no Retry when no read can be asked again: a refusal is the same however often it is asked, and a button that does nothing is not offered', () => {
    const jobs = observation(jobDefinition, { loaded: 0, complete: false, problem: denied(jobDefinition) });

    expect(model({ jobs }).attention?.retry).toBeUndefined();
  });

  it('offers no Retry for the objects that fail: they are not a read that failed', () => {
    expect(model({ pods: observation(podDefinition, { failing: [failingOf('a', 'Error', 'error')] }) }).attention?.retry).toBeUndefined();
  });
});

describe('Needs attention: the API groups that did not answer', () => {
  const groups = (value: Fact): Inputs['facts'] => factsWith({ groups: value });
  const said = { count: 3, groups: [{ groupVersion: 'metrics.k8s.io/v1beta1', reason: 'x' }, { groupVersion: 'custom.metrics.k8s.io/v1beta1', reason: 'x' }, { groupVersion: 'external.metrics.k8s.io/v1beta1', reason: 'x' }] };

  it('is one row, `3 API groups are unavailable`, with the first names, after the rest of the section', () => {
    const pods = observation(podDefinition, { failing: [failingOf('a', 'Error', 'error')] });
    const { rows } = model({ pods, facts: groups(current(said as never)) }).attention ?? { rows: [] };

    expect(rows.at(-1)).toEqual({
      id: 'api-groups',
      severity: 'attention',
      title: '3 API groups are unavailable',
      detail: { text: 'metrics.k8s.io/v1beta1, custom.metrics.k8s.io/v1beta1 and 1 more' },
      to: undefined,
    });
    expect(rows).toHaveLength(2);
  });

  it('says one group in the singular, and counts the groups the backend did not list (it names the first 32)', () => {
    expect(model({ facts: groups(current({ count: 1, groups: [{ groupVersion: 'apps/v1', reason: 'x' }] } as never)) }).attention?.rows[0]).toMatchObject({ title: '1 API group is unavailable', detail: { text: 'apps/v1' } });
    expect(model({ facts: groups(current({ count: 40, groups: [{ groupVersion: 'a/v1', reason: '' }, { groupVersion: 'b/v1', reason: '' }] } as never)) }).attention?.rows[0]).toMatchObject({ detail: { text: 'a/v1, b/v1 and 38 more' } });
  });

  it('says only how many when no name can be read', () => {
    expect(model({ facts: groups(current({ count: 2 } as never)) }).attention?.rows[0]).toMatchObject({ title: '2 API groups are unavailable', detail: undefined });
  });

  it('says the fact is stale when it is: the groups it names were last read at that time, and may answer now', () => {
    const stale: Fact = { state: 'stale', value: said as never, observedAt: 1_000 };

    expect(model({ facts: groups(stale) }).attention?.rows[0]).toMatchObject({ title: '3 API groups are unavailable', detail: { stale: { at: 1_000 } } });
  });

  it('is not a row when no group is unavailable, when the fact cannot be read, when it is on its way, or when its value is not one the backend writes', () => {
    for (const fact of [{ state: 'absent' }, { state: 'unreadable', code: undefined }, { state: 'loading' }, current({ count: 0 } as never), current('three' as never)] as Fact[]) {
      expect(model({ facts: groups(fact) }).attention, JSON.stringify(fact)).toBeUndefined();
    }
  });
});

describe('Workloads: a row for each kind the cluster serves, as the mock\'s table has them', () => {
  const rowOf = (over: Partial<Inputs>, page = 'pods') => model(over).workloads?.rows.find((row) => row.id === page);

  it('has the kinds in the mock\'s order, each a link to its list, and none the cluster does not serve', () => {
    const rows = model({ statefulSets: observation(statefulSetDefinition, { served: false, loaded: 0, complete: false }) }).workloads?.rows;

    expect(rows?.map((row) => [row.id, row.label, row.to])).toEqual([
      ['pods', 'Pods', { page: 'pods' }],
      ['deployments', 'Deployments', { page: 'deployments' }],
      ['daemonsets', 'DaemonSets', { page: 'daemonsets' }],
      ['jobs', 'Jobs', { page: 'jobs' }],
      ['cronjobs', 'CronJobs', { page: 'cronjobs' }],
    ]);
  });

  it('is not drawn when the cluster serves none of them', () => {
    const none = (kind: KindWords) => observation(kind, { served: false, loaded: 0, complete: false });

    expect(model({
      pods: none(podDefinition), deployments: none(deploymentDefinition), statefulSets: none(statefulSetDefinition), daemonSets: none(daemonSetDefinition), jobs: none(jobDefinition), cronJobs: none(cronJobDefinition),
    }).workloads).toBeUndefined();
  });

  describe('the status', () => {
    it('is Healthy when the whole set is here and nothing fails', () => {
      expect(rowOf({})?.status).toEqual({ role: 'healthy', label: 'Healthy' });
    });

    it('is Needs attention in the role of the worst of what fails: an error when one is, else attention', () => {
      const both = observation(podDefinition, { failing: [failingOf('a', 'Not ready', 'attention'), failingOf('b', 'Error', 'error')] });
      const some = observation(podDefinition, { failing: [failingOf('a', 'Not ready', 'attention')] });

      expect(rowOf({ pods: both })?.status).toEqual({ role: 'error', label: 'Needs attention' });
      expect(rowOf({ pods: some })?.status).toEqual({ role: 'attention', label: 'Needs attention' });
    });

    it('is Access denied for a kind the user may not list, and Read failed for one whose read failed: both errors', () => {
      const refused = observation(podDefinition, { loaded: 0, complete: false, problem: denied(podDefinition) });
      const failed = observation(podDefinition, { loaded: 0, complete: false, problem: problem('x') });

      expect(rowOf({ pods: refused })?.status).toEqual({ role: 'error', label: 'Access denied' });
      expect(rowOf({ pods: failed })?.status).toEqual({ role: 'error', label: 'Read failed' });
    });

    it('is Loading while the read is on its way, and while the rest of the set is: the first set says nothing of the objects that are not here', () => {
      expect(rowOf({ pods: observation(podDefinition, { loaded: 0, complete: false }) })?.status).toEqual({ role: 'progress', label: 'Loading' });
      expect(rowOf({ pods: observation(podDefinition, { loaded: 256, complete: false }) })?.status).toEqual({ role: 'progress', label: 'Loading' });
    });

    it('says what it knows first: what fails, then what could not be read, then what is on its way', () => {
      const failing = [failingOf('a', 'Error', 'error')];

      expect(rowOf({ pods: observation(podDefinition, { loaded: 256, complete: false, failing }) })?.status.label).toBe('Needs attention');
      expect(rowOf({ pods: observation(podDefinition, { loaded: 256, complete: false, problem: problem('x'), failing }) })?.status.label).toBe('Needs attention');
      expect(rowOf({ pods: observation(podDefinition, { loaded: 256, complete: false, problem: problem('x') }) })?.status.label).toBe('Read failed');
    });
  });

  describe('Total', () => {
    const total = (pods: Observation) => rowOf({ pods })?.total;

    it('is the number of objects when the whole set is here, grouped by thousands', () => {
      expect(total(observation(podDefinition, { loaded: 5025 }))).toEqual({ kind: 'text', text: '5,025' });
      expect(total(observation(podDefinition, { loaded: 0 }))).toEqual({ kind: 'text', text: '0' });
    });

    it('is the number the first page says while the set is not complete: exact, or `~N` for an estimate', () => {
      expect(total(observation(podDefinition, { loaded: 256, complete: false, said: { kind: 'exact', value: '5025' } }))).toEqual({ kind: 'text', text: '5,025' });
      expect(total(observation(podDefinition, { loaded: 256, complete: false, said: { kind: 'estimate', value: '1200' } }))).toEqual({ kind: 'text', text: '~1,200' });
    });

    it('is `N+` for a first set that says nothing of the rest: at least the objects that are here', () => {
      expect(total(observation(podDefinition, { loaded: 256, complete: false }))).toEqual({ kind: 'text', text: '256+' });
      expect(total(observation(podDefinition, { loaded: 256, complete: false, said: { kind: 'unknown' } }))).toEqual({ kind: 'text', text: '256+' });
      expect(total(observation(podDefinition, { loaded: 256, complete: false, said: { kind: 'exact', value: '007' } }))).toEqual({ kind: 'text', text: '256+' });
    });

    it('is a dash that says it is not loaded yet while nothing is here, and never a zero', () => {
      expect(total(observation(podDefinition, { loaded: 0, complete: false }))).toEqual({ kind: 'missing', name: 'Not loaded yet' });
    });

    it('says Not available for a read that failed or was refused with nothing read, and `N+` for one that failed after some objects were', () => {
      expect(total(observation(podDefinition, { loaded: 0, complete: false, problem: denied(podDefinition) }))).toEqual({ kind: 'text', text: 'Not available' });
      expect(total(observation(podDefinition, { loaded: 0, complete: false, problem: problem('x') }))).toEqual({ kind: 'text', text: 'Not available' });
      expect(total(observation(podDefinition, { loaded: 40, complete: false, problem: problem('x') }))).toEqual({ kind: 'text', text: '40+' });
    });
  });

  describe('Failing', () => {
    const failing = (pods: Observation) => rowOf({ pods })?.failing;
    const some = [failingOf('a', 'Error', 'error'), failingOf('b', 'Error', 'error'), failingOf('c', 'Error', 'error')];

    it('is the number that fail, a link to the kind\'s list', () => {
      expect(failing(observation(podDefinition, { failing: some }))).toEqual({ kind: 'link', text: '3', to: { page: 'pods' } });
    });

    it('is None failing when the whole set is here and nothing fails', () => {
      expect(failing(observation(podDefinition))).toEqual({ kind: 'text', text: 'None failing' });
    });

    it('is Not checked when the set is not complete and nothing failing was seen: the objects that are not here may', () => {
      expect(failing(observation(podDefinition, { loaded: 256, complete: false }))).toEqual({ kind: 'text', text: 'Not checked' });
    });

    it('is `N+` when the set is not complete and some were seen: at least that many', () => {
      expect(failing(observation(podDefinition, { loaded: 256, complete: false, failing: some }))).toEqual({ kind: 'link', text: '3+', to: { page: 'pods' } });
    });

    it('is Not available when nothing was read, and a dash while it is on its way', () => {
      expect(failing(observation(podDefinition, { loaded: 0, complete: false, problem: problem('x') }))).toEqual({ kind: 'text', text: 'Not available' });
      expect(failing(observation(podDefinition, { loaded: 0, complete: false }))).toEqual({ kind: 'missing', name: 'Not loaded yet' });
    });

    it('is None failing for a kind with no rule of failing, once its set is whole: a CronJob has nothing to fail', () => {
      expect(rowOf({}, 'cronjobs')?.failing).toEqual({ kind: 'text', text: 'None failing' });
    });

    // A read that failed after the set was held leaves the rows of the last good read (the runtime's query keeps the data of a refetch that failed), so the set still says it is complete and the rows say what was last
    // seen, not what is. A claim that nothing fails needs a read that succeeded and is whole.
    describe('after a read that failed on a set that was held', () => {
      const held = (over: Partial<Observation> = {}) => observation(podDefinition, { loaded: 4, complete: true, problem: problem('The cluster did not answer.'), ...over });

      it('is Not checked when nothing failing was seen, and never None failing: a refusal that came after the set was held says the same', () => {
        expect(failing(held())).toEqual({ kind: 'text', text: 'Not checked' });
        expect(failing(held({ loaded: 0 }))).toEqual({ kind: 'text', text: 'Not checked' });
        expect(failing(held({ problem: denied(podDefinition) }))).toEqual({ kind: 'text', text: 'Not checked' });
      });

      it('is `N+` when some were failing in what was last seen: the count is a floor, and the rest is unknown', () => {
        expect(failing(held({ failing: some }))).toEqual({ kind: 'link', text: '3+', to: { page: 'pods' } });
      });

      it('keeps the Total it last held, and the Status says the read failed', () => {
        expect(rowOf({ pods: held() })).toMatchObject({ total: { kind: 'text', text: '4' }, status: { role: 'error', label: 'Read failed' } });
        expect(rowOf({ pods: held({ problem: denied(podDefinition) }) })?.status).toEqual({ role: 'error', label: 'Access denied' });
      });

      it('says it of every kind whose read failed, as a control plane that stopped answering leaves them: nothing is checked, and an empty set that was held stays 0', () => {
        const stuck = (kind: KindWords) => observation(kind, { loaded: 0, problem: problem('The cluster did not answer.') });
        const over = { statefulSets: stuck(statefulSetDefinition), daemonSets: stuck(daemonSetDefinition), cronJobs: stuck(cronJobDefinition) };

        for (const page of ['statefulsets', 'daemonsets', 'cronjobs']) {
          expect(rowOf(over, page), page).toMatchObject({ status: { label: 'Read failed' }, total: { kind: 'text', text: '0' }, failing: { kind: 'text', text: 'Not checked' } });
        }
      });

      it('is still None failing for a kind whose own read is whole: another kind\'s failed read does not speak for it', () => {
        expect(rowOf({ jobs: observation(jobDefinition, { problem: problem('x') }) }, 'pods')?.failing).toEqual({ kind: 'text', text: 'None failing' });
      });
    });
  });

  describe('Retry', () => {
    it('is offered when a read failed and can be asked again, and asks it again', () => {
      const retry = vi.fn(async () => undefined);
      const pods = observation(podDefinition, { loaded: 0, complete: false, problem: problem('x', { retry }) });

      const section = model({ pods }).workloads;
      expect(section?.retry).toBeDefined();
      section?.retry?.();
      expect(retry).toHaveBeenCalledTimes(1);
    });

    it('is not offered when every read that failed was refused, nor when nothing failed', () => {
      expect(model({ pods: observation(podDefinition, { loaded: 0, complete: false, problem: denied(podDefinition) }) }).workloads?.retry).toBeUndefined();
      expect(model().workloads?.retry).toBeUndefined();
    });
  });
});

describe('Cluster: what the cluster is', () => {
  const rowsOf = (over: Partial<Inputs> = {}) => model(over).cluster;
  const row = (id: string, over: Partial<Inputs> = {}) => rowsOf(over).find((candidate) => candidate.id === id);

  it('has the Kubernetes version, the Nodes, the Namespaces and the API server, in that order, and no capacity or runtime: no Node row carries them, and no zero stands for them', () => {
    expect(rowsOf().map((candidate) => [candidate.id, candidate.label])).toEqual([
      ['version', 'Kubernetes version'],
      ['nodes', 'Nodes'],
      ['namespaces', 'Namespaces'],
      ['api-server', 'API server'],
    ]);
  });

  describe('Nodes', () => {
    it('says how many there are and how many are ready, a link to the list: `3 · 2 ready`', () => {
      expect(row('nodes', { nodes: observation(nodeDefinition, { loaded: 3 }), nodesReady: 2 })?.value).toEqual({ kind: 'link', text: '3 · 2 ready', to: { page: 'nodes' } });
    });

    it('says how many of the objects that are here are ready when the set is not complete, never the ready ones of the total', () => {
      const nodes = observation(nodeDefinition, { loaded: 256, complete: false, said: { kind: 'estimate', value: '300' } });

      expect(row('nodes', { nodes, nodesReady: 250 })?.value).toEqual({ kind: 'link', text: '~300 · 250 of the first 256 ready', to: { page: 'nodes' } });
    });

    // A read that failed after the set was held leaves the rows of the last good read: the row says what it last held and that it could not be refreshed, and is never drawn as current.
    it('says what it last held and that it could not be refreshed when the read failed after the set was held: `3 · 3 ready · could not be refreshed`', () => {
      const held = observation(nodeDefinition, { loaded: 3, problem: problem('The cluster did not answer.') });

      expect(row('nodes', { nodes: held, nodesReady: 3 })?.value).toEqual({ kind: 'link', text: '3 · 3 ready', to: { page: 'nodes' }, note: 'could not be refreshed' });
    });

    it('says it for a refusal that came after the set was held, and for a first set whose collection failed', () => {
      const refused = observation(nodeDefinition, { loaded: 3, problem: denied(nodeDefinition) });
      const first = observation(nodeDefinition, { loaded: 256, complete: false, problem: problem('x') });

      expect(row('nodes', { nodes: refused, nodesReady: 2 })?.value).toMatchObject({ kind: 'link', text: '3 · 2 ready', note: 'could not be refreshed' });
      expect(row('nodes', { nodes: first, nodesReady: 250 })?.value).toMatchObject({ kind: 'link', text: '256+ · 250 of the first 256 ready', note: 'could not be refreshed' });
    });

    it('says no note of a read that is whole', () => {
      expect(row('nodes', { nodes: observation(nodeDefinition, { loaded: 3 }), nodesReady: 2 })?.value).not.toHaveProperty('note');
    });

    it('is on its way while the read is, and says why when it cannot be read', () => {
      expect(row('nodes', { nodes: observation(nodeDefinition, { loaded: 0, complete: false }) })?.value).toEqual({ kind: 'loading' });
      expect(row('nodes', { nodes: observation(nodeDefinition, { loaded: 0, complete: false, problem: denied(nodeDefinition) }) })?.value).toEqual({ kind: 'words', text: 'Access denied' });
      expect(row('nodes', { nodes: observation(nodeDefinition, { loaded: 0, complete: false, problem: problem('x') }) })?.value).toEqual({ kind: 'words', text: 'Could not be read' });
    });

    it('is not a row when the cluster does not serve Nodes', () => {
      expect(row('nodes', { nodes: observation(nodeDefinition, { served: false, loaded: 0, complete: false }) })).toBeUndefined();
    });
  });

  describe('Namespaces', () => {
    it('says how many there are, a link to the list', () => {
      expect(row('namespaces', { namespaces: observation(namespaceDefinition, { loaded: 12 }) })?.value).toEqual({ kind: 'link', text: '12', to: { page: 'namespaces' } });
    });

    it('says `N+` for a first set that says nothing of the rest, and `~N` for an estimate', () => {
      expect(row('namespaces', { namespaces: observation(namespaceDefinition, { loaded: 256, complete: false }) })?.value).toMatchObject({ text: '256+' });
      expect(row('namespaces', { namespaces: observation(namespaceDefinition, { loaded: 256, complete: false, said: { kind: 'estimate', value: '900' } }) })?.value).toMatchObject({ text: '~900' });
    });

    it('says what it last held and that it could not be refreshed when the read failed after the set was held: `8 · could not be refreshed`', () => {
      const held = observation(namespaceDefinition, { loaded: 8, problem: problem('The cluster did not answer.') });
      const refused = observation(namespaceDefinition, { loaded: 8, problem: denied(namespaceDefinition) });

      expect(row('namespaces', { namespaces: held })?.value).toEqual({ kind: 'link', text: '8', to: { page: 'namespaces' }, note: 'could not be refreshed' });
      expect(row('namespaces', { namespaces: refused })?.value).toMatchObject({ kind: 'link', text: '8', note: 'could not be refreshed' });
    });

    it('says no note of a read that is whole', () => {
      expect(row('namespaces', { namespaces: observation(namespaceDefinition, { loaded: 8 }) })?.value).not.toHaveProperty('note');
    });

    it('is on its way while the read is, and says why when it cannot be read', () => {
      expect(row('namespaces', { namespaces: observation(namespaceDefinition, { loaded: 0, complete: false }) })?.value).toEqual({ kind: 'loading' });
      expect(row('namespaces', { namespaces: observation(namespaceDefinition, { loaded: 0, complete: false, problem: denied(namespaceDefinition) }) })?.value).toEqual({ kind: 'words', text: 'Access denied' });
    });

    it('is not a row when the cluster does not serve Namespaces', () => {
      expect(row('namespaces', { namespaces: observation(namespaceDefinition, { served: false, loaded: 0, complete: false }) })).toBeUndefined();
    });
  });

  describe.each([['version', 'version', 'v1.35.0'], ['api-server', 'url', 'https://10.0.0.1:6443']] as const)('the %s row, from the fact %s', (id, name, value) => {
    const facts = (fact: Fact) => ({ facts: factsWith({ [name]: fact }) });

    it('says a fact that is current', () => {
      expect(row(id, facts(current(value)))?.value).toMatchObject({ kind: 'text', text: value });
    });

    it('says a fact that is stale as stale, with its value and when it was read: never as current', () => {
      expect(row(id, facts({ state: 'stale', value, observedAt: 1_000 }))?.value).toMatchObject({ kind: 'stale', text: value, at: 1_000 });
      expect(row(id, facts({ state: 'stale', value, observedAt: undefined }))?.value).toMatchObject({ kind: 'stale', text: value, at: undefined });
    });

    it('says why a fact is not known, in a person\'s words: the server did not report it, or it could not be read', () => {
      expect(row(id, facts({ state: 'unreadable', code: 'NOT_REPORTED' }))?.value).toEqual({ kind: 'words', text: 'Not reported by the server' });
      expect(row(id, facts({ state: 'absent' }))?.value).toEqual({ kind: 'words', text: 'Not reported by the server' });
      expect(row(id, facts({ state: 'unreadable', code: 'OBSERVATION_FAILED' }))?.value).toEqual({ kind: 'words', text: 'Could not be read' });
      expect(row(id, facts({ state: 'unreadable', code: 'CLIENT_UNAVAILABLE' }))?.value).toEqual({ kind: 'words', text: 'Could not be read' });
      expect(row(id, facts({ state: 'unreadable', code: undefined }))?.value).toEqual({ kind: 'words', text: 'Could not be read' });
    });

    it('is on its way while the connection\'s facts are', () => {
      expect(row(id, facts({ state: 'loading' }))?.value).toEqual({ kind: 'loading' });
    });

    it('says a value that is not text as one that could not be read: nothing is guessed', () => {
      expect(row(id, facts(current(42 as never)))?.value).toEqual({ kind: 'words', text: 'Could not be read' });
      expect(row(id, facts(current('' as never)))?.value).toEqual({ kind: 'words', text: 'Could not be read' });
    });
  });

  it('says the version as the mock does, three numbers, and the whole version in the tip', () => {
    expect(row('version', { facts: factsWith({ version: current('v1.31.4-eks-aeac579') }) })?.value).toEqual({ kind: 'text', text: 'v1.31.4', tip: 'v1.31.4-eks-aeac579' });
    expect(row('version', { facts: factsWith({ version: { state: 'stale', value: 'v1.31.4-eks-aeac579', observedAt: 5 } }) })?.value).toEqual({ kind: 'stale', text: 'v1.31.4', tip: 'v1.31.4-eks-aeac579', at: 5 });
  });

  it('says the address of the API server in the code face, across the whole row', () => {
    expect(row('api-server')).toMatchObject({ mono: true, wide: true });
    expect(row('version')).not.toHaveProperty('mono');
  });
});

describe('the summary: the one line that leads the first screen', () => {
  const summary = (over: Partial<Inputs> = {}) => model(over).summary;
  const failing = (word: string, role: 'error' | 'attention') => [failingOf('a', word, role)];

  it('says Everything is running, in the healthy tone, when nothing fails and every read is whole', () => {
    expect(summary()).toEqual([{ text: 'Everything is running', tone: 'success' }]);
  });

  it('says Needs attention and how many objects fail, in the tone of the worst of them', () => {
    expect(summary({ pods: observation(podDefinition, { failing: [...failing('Error', 'error'), ...failing('Not ready', 'attention')] }) })).toEqual([
      { text: 'Needs attention', tone: 'error' },
      { value: '2', label: 'failing' },
    ]);
    expect(summary({ deployments: observation(deploymentDefinition, { failing: failing('Partially ready', 'attention') }) })).toEqual([
      { text: 'Needs attention', tone: 'warning' },
      { value: '1', label: 'failing' },
    ]);
  });

  it('says what could not be checked when a read failed, and no number of failing objects it did not see', () => {
    const jobs = observation(jobDefinition, { loaded: 0, complete: false, problem: denied(jobDefinition) });
    const nodes = observation(nodeDefinition, { loaded: 0, complete: false, problem: problem('x') });

    expect(summary({ jobs, nodes })).toEqual([
      { text: 'Needs attention', tone: 'warning' },
      { text: 'Not checked: Jobs, Nodes', tone: 'warning' },
    ]);
  });

  it('says what failed and what could not be checked together', () => {
    const pods = observation(podDefinition, { failing: failing('Error', 'error') });
    const jobs = observation(jobDefinition, { loaded: 0, complete: false, problem: denied(jobDefinition) });

    expect(summary({ pods, jobs })).toEqual([
      { text: 'Needs attention', tone: 'error' },
      { value: '1', label: 'failing' },
      { text: 'Not checked: Jobs', tone: 'warning' },
    ]);
  });

  it('is Checking, and says which kinds are not checked in full yet, while the whole set of one is on its way: it does not say everything runs on the first 256 Pods', () => {
    const pods = observation(podDefinition, { loaded: 256, complete: false });
    const jobs = observation(jobDefinition, { loaded: 0, complete: false });

    expect(summary({ pods, jobs })).toEqual([
      { status: { role: 'progress', label: 'Checking' } },
      { text: 'Not checked in full yet: Pods, Jobs', tone: 'warning' },
    ]);
  });

  it('is Checking while the connection\'s facts are on their way: a group that does not answer may be among them', () => {
    expect(summary({ facts: factsWith({ groups: { state: 'loading' } }) })).toEqual([{ status: { role: 'progress', label: 'Checking' } }]);
  });

  it('says the API groups were not checked when the fact that names them cannot be read, and does not say everything runs', () => {
    expect(summary({ facts: factsWith({ groups: { state: 'unreadable', code: undefined } }) })).toEqual([
      { text: 'Nothing failing in what was checked' },
      { text: 'Not checked: API groups', tone: 'warning' },
    ]);
  });

  it('says Needs attention when API groups do not answer, though every object is well', () => {
    expect(summary({ facts: factsWith({ groups: current({ count: 2, groups: [] } as never) }) })).toEqual([{ text: 'Needs attention', tone: 'warning' }]);
  });

  it('is not held back by what is on its way when it decides nothing: a CronJob has nothing to fail, and the Namespaces are a count', () => {
    const cronJobs = observation(cronJobDefinition, { loaded: 0, complete: false });
    const namespaces = observation(namespaceDefinition, { loaded: 0, complete: false });

    expect(summary({ cronJobs, namespaces })).toEqual([{ text: 'Everything is running', tone: 'success' }]);
  });

  it('says a CronJob that cannot be listed, as the section does: a read that failed is not everything running; the Namespaces are not in it, they are a count', () => {
    const cronJobs = observation(cronJobDefinition, { loaded: 0, complete: false, problem: problem('x') });
    const namespaces = observation(namespaceDefinition, { loaded: 0, complete: false, problem: problem('x') });

    expect(summary({ cronJobs, namespaces })).toEqual([{ text: 'Needs attention', tone: 'warning' }, { text: 'Not checked: CronJobs', tone: 'warning' }]);
  });

  it('is not moved by a kind the cluster does not serve', () => {
    const gone = observation(statefulSetDefinition, { served: false, loaded: 0, complete: false });

    expect(summary({ statefulSets: gone })).toEqual([{ text: 'Everything is running', tone: 'success' }]);
  });

  it('says nothing when the cluster serves none of the kinds it judges: there is nothing to say everything runs of', () => {
    const none = (kind: KindWords) => observation(kind, { served: false, loaded: 0, complete: false });

    expect(summary({
      pods: none(podDefinition), deployments: none(deploymentDefinition), statefulSets: none(statefulSetDefinition), daemonSets: none(daemonSetDefinition), jobs: none(jobDefinition), claims: none(persistentVolumeClaimDefinition),
      nodes: none(nodeDefinition),
    })).toEqual([]);
  });
});
