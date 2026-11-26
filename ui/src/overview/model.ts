import type { LinkTarget, PageHeaderFact, PageHeaderState, StatusSummaryItem } from '@omniviewdev/kit';

import { detailTarget } from '../kinds';
import { versionText } from '../kinds/fields';
import type { StateRole } from '../kinds/status';
import { sidebarCount } from '../sidebar/count';

import type { Failing, Observation, Severity } from './assess';
import { distributionWords, groupsOf, platformWords, type Fact, type Facts } from './facts';

// The overview as plain data (the mock's `k8s-cluster.js`): what each section says, from what each kind's read says (`assess.ts`) and what the connection's facts say (`facts.ts`). A pure function of its inputs: it
// reads nothing and draws nothing, so every state the page can be in is a value to look at. `view.tsx` draws it; `useOverviewPage.ts` reads it.
//
// The mock's page asks five questions (:1-13). Three are answered here: what needs attention, what runs in it (the Workloads table) and what the cluster is (the Cluster section). The other two are not: how loaded it
// is needs usage, which no hook of the runtime serves the UI, and what changed needs Events, which the plugin has no kind for. The page says nothing of them, and no zero or dash stands for either.

const grouped = (value: number): string => value.toLocaleString('en-US');

/** What the overview says in a place that holds text: the text, and for a fact that is not current, when it was last read (the view keeps that current). */
export type Words = { readonly text: string; readonly stale?: { readonly at: number | undefined } };

/** One row of Needs attention. A row with no `to` is not a link: the objects it speaks of have no page to go to. */
export type AttentionRow = {
  readonly id: string;
  /** How badly: the glyph of the row. */
  readonly severity: Severity;
  readonly title: string;
  readonly detail: Words | undefined;
  readonly to: LinkTarget | undefined;
};

export type Attention = {
  readonly rows: readonly AttentionRow[];
  /** How many objects fail. Nothing when none does: the rows are reads that failed, and no zero is made up. */
  readonly count: number | undefined;
  /** Asks again every read that failed and can be asked again. Absent when none can: a refusal is the same however often it is asked. */
  readonly retry: (() => void) | undefined;
};

/** A number or a state in a cell: text, a link (a count of what fails), or a dash that says what is missing. */
export type Figure =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly to: LinkTarget }
  | { readonly kind: 'missing'; readonly name: string };

export type WorkloadRow = {
  readonly id: string;
  readonly label: string;
  readonly to: LinkTarget;
  readonly status: { readonly role: StateRole; readonly label: string };
  readonly total: Figure;
  readonly failing: Figure;
};

export type Workloads = {
  readonly rows: readonly WorkloadRow[];
  readonly retry: (() => void) | undefined;
};

/** What a row of the Cluster section says. A fact that is not known says why in a person's words (`words`), and one that is not current says so (`stale`). */
export type Value =
  | { readonly kind: 'text'; readonly text: string; readonly tip?: string }
  /** A count that is a link to its list. `note` says what more is known of it: that it could not be refreshed, so that the count is what the last good read held. */
  | { readonly kind: 'link'; readonly text: string; readonly to: LinkTarget; readonly note?: string }
  | { readonly kind: 'stale'; readonly text: string; readonly tip?: string; readonly at: number | undefined }
  | { readonly kind: 'loading' }
  | { readonly kind: 'words'; readonly text: string };

export type ClusterRow = {
  readonly id: string;
  readonly label: string;
  readonly value: Value;
  readonly mono?: true;
  readonly wide?: true;
};

export type OverviewModel = {
  /** The header's chip: the connection's state. */
  readonly state: PageHeaderState;
  /** The header's facts: which cluster this is. */
  readonly facts: readonly PageHeaderFact[];
  /** The one line that leads the first screen. */
  readonly summary: readonly StatusSummaryItem[];
  readonly attention: Attention | undefined;
  readonly workloads: Workloads | undefined;
  readonly cluster: readonly ClusterRow[];
};

/** What the overview is made from: what each kind's read says, in the order the mock's table has them, the Nodes that are ready, and the connection's facts. */
export type Inputs = {
  readonly pods: Observation;
  readonly deployments: Observation;
  readonly statefulSets: Observation;
  readonly daemonSets: Observation;
  readonly jobs: Observation;
  readonly cronJobs: Observation;
  readonly claims: Observation;
  readonly nodes: Observation;
  readonly namespaces: Observation;
  /** How many of the Nodes that are here are ready. */
  readonly nodesReady: number;
  readonly facts: Facts;
};

const NOT_REPORTED = 'Not reported by the server';
const COULD_NOT_BE_READ = 'Could not be read';

// --- what needs attention ---------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The words after the count in a row's title (the mock's `phrase`): `3 Pods in CrashLoopBackOff`, `1 Node not ready`, `2 Deployments partially ready`, `1 Pod with an error`. A word the platform spells as one name
 * (CrashLoopBackOff, OOMKilled, Init:Error, ExitCode:137) follows `in`; the others read as the phrase they are.
 */
function phrase(word: string): string {
  if (word === 'NotReady') {
    return 'not ready';
  }

  if (word === 'Error') {
    return 'with an error';
  }

  return !/\s/.test(word) && /[a-z0-9][A-Z]|^[A-Z]{2}|:/.test(word) ? `in ${word}` : word.toLowerCase();
}

/** The first two names of `total` objects, and how many more: `api-1, api-2 and 3 more`. */
function firstNames(names: readonly string[], total: number): string {
  const first = names.slice(0, 2);
  return `${first.join(', ')}${total > first.length ? ` and ${grouped(total - first.length)} more` : ''}`;
}

type Group = { readonly observation: Observation; readonly word: string; readonly items: readonly Failing[] };

/** The objects of a kind that fail, by the word that says how: one group each. The words of a kind keep the order they were first seen in. */
function groupsOfKind(observation: Observation): readonly Group[] {
  const byWord = new Map<string, Failing[]>();
  for (const item of observation.failing) {
    byWord.set(item.word, [...(byWord.get(item.word) ?? []), item]);
  }

  return [...byWord].map(([word, items]) => ({ observation, word, items }));
}

function groupRow({ observation, word, items }: Group): AttentionRow {
  const { kind } = observation;
  const [first] = items;
  const alone = items.length === 1 && first !== undefined;
  const title = `${grouped(items.length)} ${items.length === 1 ? kind.nouns.one : kind.nouns.other} ${phrase(word)}`;
  const detail = alone
    ? [first.name, first.namespace, first.extra].filter((part): part is string => part !== undefined && part !== '').join(' · ')
    : firstNames(items.map((item) => item.name), items.length);
  // One object opens its own page, when the plugin has one, as the mock opens it; several open the kind's list, which has no filter a route can name, so it is the whole list.
  const own = alone ? detailTarget({ kind: kind.kind, name: first.name, namespace: first.namespace === '' ? undefined : first.namespace }) : undefined;
  return { id: `${kind.page}:${word}`, severity: items[0]?.role ?? 'attention', title, detail: { text: detail }, to: own ?? { page: kind.page } };
}

/** The API groups that did not answer, as one row: what the backend says of the catalog, and when it was last read if that is not now. */
function groupsFactRow(fact: Fact): AttentionRow | undefined {
  if (fact.state !== 'current' && fact.state !== 'stale') {
    return undefined;
  }

  const groups = groupsOf(fact.value);
  if (groups === undefined) {
    return undefined;
  }

  const names = groups.names.length === 0 ? '' : firstNames(groups.names, groups.count);
  const detail: Words | undefined = fact.state === 'stale' ? { text: names, stale: { at: fact.observedAt } } : names === '' ? undefined : { text: names };
  return { id: 'api-groups', severity: 'attention', title: `${grouped(groups.count)} API ${groups.count === 1 ? 'group is' : 'groups are'} unavailable`, detail, to: undefined };
}

function attentionOf(ranked: readonly Observation[], groups: Fact): Attention | undefined {
  const served = ranked.filter((observation) => observation.served);
  const failing = served.flatMap(groupsOfKind);
  // The errors first, then the kinds in the mock's rank; the sort is stable, so the words of one kind keep their order.
  const rows: AttentionRow[] = [
    ...failing.map(groupRow).sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error')),
    ...served.flatMap((observation): AttentionRow[] =>
      observation.problem === undefined
        ? []
        : [{ id: `${observation.kind.page}:unreadable`, severity: 'attention', title: `${observation.kind.nouns.other} can't be listed`, detail: { text: observation.problem.cause }, to: undefined }]),
  ];
  const unavailable = groupsFactRow(groups);
  if (unavailable !== undefined) {
    rows.push(unavailable);
  }

  if (rows.length === 0) {
    return undefined;
  }

  const items = served.reduce((total, observation) => total + observation.failing.length, 0);
  return { rows, count: items > 0 ? items : undefined, retry: retryOf(served) };
}

/** Asks again every read of `observations` that failed and can be asked again; nothing when none can. */
function retryOf(observations: readonly Observation[]): (() => void) | undefined {
  const retries = observations.flatMap((observation) => (observation.served && observation.problem?.retry !== undefined ? [observation.problem.retry] : []));
  if (retries.length === 0) {
    return undefined;
  }

  return () => {
    for (const retry of retries) {
      void retry();
    }
  };
}

// --- what runs in it ----------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * How many objects a kind holds, as a text: the number when the whole set is here, what the first page says while it is not (exact, or `~N` for an estimate), and `N+` when it says nothing of the rest: at least the
 * objects that are here. Nothing when none is.
 */
function totalOf(observation: Observation): string | undefined {
  if (observation.complete) {
    return grouped(observation.loaded);
  }

  const said = sidebarCount(observation.said);
  if (said !== null) {
    return typeof said === 'number' ? grouped(said) : `~${grouped(said.value)}`;
  }

  return observation.loaded > 0 ? `${grouped(observation.loaded)}+` : undefined;
}

const LOADING: Figure = { kind: 'missing', name: 'Not loaded yet' };
const NOT_AVAILABLE: Figure = { kind: 'text', text: 'Not available' };

/** What a figure says when there is nothing to count: a read that failed says so, and one that is on its way is a dash. */
const unknownFigure = ({ problem }: Observation): Figure => (problem === undefined ? LOADING : NOT_AVAILABLE);

function totalFigure(observation: Observation): Figure {
  const text = totalOf(observation);
  return text === undefined ? unknownFigure(observation) : { kind: 'text', text };
}

function failingFigure(observation: Observation): Figure {
  const { failing, complete, loaded, problem } = observation;
  // A claim that nothing fails needs a read that succeeded and is whole. A read that failed after the set was held leaves the rows of the last good read (the runtime's query keeps the data of a refetch that failed): they
  // say what was last seen and not what is, so what failed in them is a count of at least that many, and that nothing fails is not known.
  const whole = complete && problem === undefined;
  if (failing.length > 0) {
    // A count of an incomplete set, or of one that could not be refreshed, is at least that many: the objects that are not here, or that changed since, may fail too.
    return { kind: 'link', text: whole ? grouped(failing.length) : `${grouped(failing.length)}+`, to: { page: observation.kind.page } };
  }

  if (whole) {
    return { kind: 'text', text: 'None failing' };
  }

  // Something was held, whole or not, and is not known to be so now. A kind that has read nothing says why in `unknownFigure`.
  return loaded > 0 || complete ? { kind: 'text', text: 'Not checked' } : unknownFigure(observation);
}

/** What is known first: what fails, then what could not be read, then what is on its way, then that nothing is wrong. */
function statusOf({ failing, problem, complete }: Observation): WorkloadRow['status'] {
  if (failing.length > 0) {
    return { role: failing.some((item) => item.role === 'error') ? 'error' : 'attention', label: 'Needs attention' };
  }

  if (problem !== undefined) {
    return { role: 'error', label: problem.denied ? 'Access denied' : 'Read failed' };
  }

  return complete ? { role: 'healthy', label: 'Healthy' } : { role: 'progress', label: 'Loading' };
}

function workloadsOf(table: readonly Observation[]): Workloads | undefined {
  const served = table.filter((observation) => observation.served);
  if (served.length === 0) {
    return undefined;
  }

  const rows = served.map((observation): WorkloadRow => ({
    id: observation.kind.page,
    label: observation.kind.nouns.other,
    to: { page: observation.kind.page },
    status: statusOf(observation),
    total: totalFigure(observation),
    failing: failingFigure(observation),
  }));
  return { rows, retry: retryOf(served) };
}

// --- what the cluster is -----------------------------------------------------------------------------------------------------------------------------------------------

const textOf = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/**
 * A fact as a row says it. A fact that is current is its value; one that is not is the last value and when it was read, never drawn as current; one that is not known says why in a person's words: the server did
 * not report it, or it could not be read. Never a dash for a failure.
 */
function valueOf(fact: Fact, say: (text: string) => { readonly text: string; readonly tip?: string }): Value {
  switch (fact.state) {
    case 'loading':
      return { kind: 'loading' };
    case 'absent':
      return { kind: 'words', text: NOT_REPORTED };
    case 'unreadable':
      return { kind: 'words', text: fact.code === 'NOT_REPORTED' ? NOT_REPORTED : COULD_NOT_BE_READ };
    case 'current': {
      const text = textOf(fact.value);
      return text === undefined ? { kind: 'words', text: COULD_NOT_BE_READ } : { kind: 'text', ...say(text) };
    }

    case 'stale': {
      const text = textOf(fact.value);
      return text === undefined ? { kind: 'words', text: COULD_NOT_BE_READ } : { kind: 'stale', ...say(text), at: fact.observedAt };
    }
  }
}

const asGiven = (text: string): { readonly text: string } => ({ text });

/** What a count row says when there is nothing to count. */
const unknownValue = ({ problem }: Observation): Value => (problem === undefined ? { kind: 'loading' } : { kind: 'words', text: problem.denied ? 'Access denied' : COULD_NOT_BE_READ });

const COULD_NOT_BE_REFRESHED = 'could not be refreshed';

/**
 * The value of a count row: the count as a link to its list. When the read failed after the count was held, the count is the last good read's and the row says it could not be refreshed (`3 · 3 ready · could not be
 * refreshed`): it is never drawn as current.
 */
function countValue(observation: Observation, text: string): Value {
  const link = { kind: 'link', text, to: { page: observation.kind.page } } as const;
  return observation.problem === undefined ? link : { ...link, note: COULD_NOT_BE_REFRESHED };
}

function nodesRow(observation: Observation, ready: number): ClusterRow | undefined {
  if (!observation.served) {
    return undefined;
  }

  const total = totalOf(observation);
  if (total === undefined) {
    return { id: 'nodes', label: 'Nodes', value: unknownValue(observation) };
  }

  // Of an incomplete set the ready Nodes are those of the Nodes that are here: never the ready ones of the total.
  const text = observation.complete ? `${total} · ${grouped(ready)} ready` : `${total} · ${grouped(ready)} of the first ${grouped(observation.loaded)} ready`;
  return { id: 'nodes', label: 'Nodes', value: countValue(observation, text) };
}

function namespacesRow(observation: Observation): ClusterRow | undefined {
  if (!observation.served) {
    return undefined;
  }

  const total = totalOf(observation);
  return { id: 'namespaces', label: 'Namespaces', value: total === undefined ? unknownValue(observation) : countValue(observation, total) };
}

/**
 * The Cluster section (the mock's :255-282): the Kubernetes version, the Nodes, the Namespaces and the API server. The mock's CPU and Memory capacity and Runtime are not here: they are sums over the Nodes' capacity
 * and their container runtime, which no Node row carries (`kinds/nodes/row.ts` holds the status, the version and the address), and a row without its number would say a zero or a dash for what is not known.
 */
function clusterOf({ nodes, nodesReady, namespaces, facts }: Inputs): readonly ClusterRow[] {
  const rows: ReadonlyArray<ClusterRow | undefined> = [
    { id: 'version', label: 'Kubernetes version', value: valueOf(facts.version, versionText) },
    nodesRow(nodes, nodesReady),
    namespacesRow(namespaces),
    { id: 'api-server', label: 'API server', value: valueOf(facts.url, asGiven), mono: true, wide: true },
  ];
  return rows.filter((row): row is ClusterRow => row !== undefined);
}

// --- the header ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** A fact that is current and a word, in the words a person reads. */
function wordOf(fact: Fact, words: (text: string) => string): string | undefined {
  const text = fact.state === 'current' ? textOf(fact.value) : undefined;
  return text === undefined ? undefined : words(text);
}

/**
 * Which cluster this is (the mock's `identityOf`, k8s-cluster.js:244): the platform or distribution, and the version of the server. Only facts that are current: the header is the cluster's identity, and a fact that
 * is not current would be drawn as if it were (the Cluster section says when one is stale).
 */
function factsOf(facts: Facts): readonly PageHeaderFact[] {
  const platform = wordOf(facts.platform, platformWords);
  const distribution = wordOf(facts.distribution, distributionWords);
  const version = wordOf(facts.version, (text) => versionText(text).text);
  return [platform, distribution === platform ? undefined : distribution, version].filter((text): text is string => text !== undefined).map((text) => ({ text }));
}

// --- the summary --------------------------------------------------------------------------------------------------------------------------------------------------------

const names = (observations: readonly Observation[], more: readonly string[] = []): string => [...observations.map((observation) => observation.kind.nouns.other), ...more].join(', ');

/**
 * The one line that leads the first screen. It says what is known and never more: Everything is running only when every read of the kinds that can fail is whole and nothing fails, Checking while the whole set of
 * one is on its way (the first 256 Pods say nothing of the rest), and what was not checked when a read failed or the connection's facts cannot be read. A kind the cluster does not serve is not mentioned, and one
 * that has no rule (the CronJobs) and the Namespaces, which are a count, do not hold the line back.
 */
function summaryOf({ pods, deployments, statefulSets, daemonSets, jobs, cronJobs, claims, nodes, facts }: Inputs, attention: Attention | undefined, ranked: readonly Observation[]): readonly StatusSummaryItem[] {
  const judged = [pods, deployments, statefulSets, daemonSets, jobs, claims, nodes].filter((observation) => observation.served);
  if (judged.length === 0) {
    return [];
  }

  const waiting = judged.filter((observation) => observation.problem === undefined && !observation.complete);
  if (waiting.length > 0 || facts.groups.state === 'loading') {
    return [{ status: { role: 'progress', label: 'Checking' } }, ...(waiting.length === 0 ? [] : [{ text: `Not checked in full yet: ${names(waiting)}`, tone: 'warning' as const }])];
  }

  // Everything above is whole or failed: what is not checked is what failed, and the groups when their fact cannot be read.
  const missed = [...ranked.filter((observation) => observation.served && observation.problem !== undefined)];
  const unchecked = facts.groups.state === 'unreadable' ? [...missed.map((observation) => observation.kind.nouns.other), 'API groups'] : missed.map((observation) => observation.kind.nouns.other);
  const notChecked: readonly StatusSummaryItem[] = unchecked.length === 0 ? [] : [{ text: `Not checked: ${unchecked.join(', ')}`, tone: 'warning' }];
  if (attention === undefined) {
    return unchecked.length === 0 ? [{ text: 'Everything is running', tone: 'success' }] : [{ text: 'Nothing failing in what was checked' }, ...notChecked];
  }

  const worst = [pods, deployments, statefulSets, daemonSets, jobs, cronJobs, claims, nodes].some((observation) => observation.served && observation.failing.some((item) => item.role === 'error'));
  return [{ text: 'Needs attention', tone: worst ? 'error' : 'warning' }, ...(attention.count === undefined ? [] : [{ value: grouped(attention.count), label: 'failing' }]), ...notChecked];
}

/**
 * The overview, from what each kind's read says and what the connection's facts say. The page is only drawn for a connection that is connected, so the chip says so; the connection's other states are the page's own
 * state (`state.ts`), which replaces the body.
 */
export function overviewModel(inputs: Inputs): OverviewModel {
  const { pods, deployments, statefulSets, daemonSets, jobs, cronJobs, claims, nodes, facts } = inputs;
  // The mock's order of kinds (`RANK`): the six of the Workloads table, then the claims and the Nodes.
  const table = [pods, deployments, statefulSets, daemonSets, jobs, cronJobs];
  const ranked = [...table, claims, nodes];
  const attention = attentionOf(ranked, facts.groups);
  return {
    state: { role: 'healthy', label: 'Connected' },
    facts: factsOf(facts),
    summary: summaryOf(inputs, attention, ranked),
    attention,
    workloads: workloadsOf(table),
    cluster: clusterOf(inputs),
  };
}
