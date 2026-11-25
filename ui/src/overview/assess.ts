import type { Count } from '@omniviewdev/runtime/ui/v1';

import type { DaemonSetRow } from '../kinds/daemonsets/row';
import type { KindDefinition, KindRow, Ratio } from '../kinds/definition';
import type { JobRow } from '../kinds/jobs/row';
import type { NodeRow } from '../kinds/nodes/row';
import type { PersistentVolumeClaimRow } from '../kinds/persistentvolumeclaims/row';
import type { PodRow } from '../kinds/pods/row';
import { kindListSource } from '../kinds/source';
import type { KindStatus } from '../kinds/status';
import type { KindView } from '../kinds/useKindRows';
import { ALL_NAMESPACES } from '../sidebar/scope';

// What the cluster overview counts as failing, kind by kind, and what it says of one kind's read. The rules are the mock's `assess` (k8s-cluster.js:191-253), written over the rows the kinds make of the objects a
// cluster serves, so that no state word is made again here: a Pod, a Job, a Node, a claim or a workload is failing when the word its own row says is an error or needs attention (`kinds/status.ts`, `kinds/workload.ts`,
// each `<kind>/row.ts`). The two words the overview adds are the mock's own, and are said where they are made: a Pod that runs and is not ready, and a claim that has waited too long.

/** What the overview speaks of a kind with: its words, its page and its type. A kind's definition is that, and more. */
export type KindWords = Pick<KindDefinition<KindRow>, 'kind' | 'nouns' | 'page' | 'type'>;

/** How badly an object fails: an error, or it needs a look. The roles of the table that make an object appear on the page; the others (running, progress, stopped, healthy, info) do not. */
export type Severity = 'error' | 'attention';

/** What a rule says of a row that fails: the word, its role, and what more is known of the object when it is shown alone. */
export type Verdict = { readonly word: string; readonly role: Severity; readonly extra?: string };

/** A kind's rule: whether the row fails, at the instant `now` (a claim fails when it has waited long enough). Nothing for a row that does not. */
export type Rule<TRow extends KindRow> = (row: TRow, now: number) => Verdict | undefined;

/** An object that fails, as the page lists it: which it is, and what is wrong with it. */
export type Failing = {
  readonly name: string;
  /** Empty for a kind that lives in no namespace. */
  readonly namespace: string;
  readonly word: string;
  readonly role: Severity;
  /** What more is known of it: `3 restarts`, `1 of 3 ready`, `waiting for a volume`. */
  readonly extra: string | undefined;
};

const counted = (value: number, one: string): string => `${value.toLocaleString('en-US')} ${one}${value === 1 ? '' : 's'}`;

/** The word of a row whose role is one of the two that fail. */
function byRole({ status }: { readonly status: KindStatus | undefined }, extra?: string): Verdict | undefined {
  return status?.role === 'error' || status?.role === 'attention' ? { word: status.word, role: status.role, ...(extra === undefined ? {} : { extra }) } : undefined;
}

const readyOf = ({ ready, total }: Ratio): string => `${ready.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ready`;

/**
 * Pods: the status word's role (kubectl's STATUS: CrashLoopBackOff, Error, an image that cannot be pulled), and a Pod that is Running and has containers that are not ready, which the mock calls Not ready (k8s-cluster.js:197):
 * the Pod's `Ready` condition is False when a container is not ready, and the row holds the containers' count, not the condition. A Pod that restarted says how many times.
 */
export const podRule: Rule<PodRow> = (row) => {
  const extra = row.restarts !== undefined && row.restarts > 0 ? counted(row.restarts, 'restart') : undefined;
  const failed = byRole(row, extra);
  if (failed !== undefined) {
    return failed;
  }

  const { ready } = row;
  return row.status?.role === 'running' && ready !== undefined && ready.ready < ready.total ? { word: 'Not ready', role: 'attention', ...(extra === undefined ? {} : { extra }) } : undefined;
};

/** Jobs: a Job whose state is Failed (`jobState`: the Failed condition, when the Job did not complete). */
export const jobRule: Rule<JobRow> = (row) => byRole(row);

/** Nodes: a Node that is not Ready (NotReady is an error, Unknown, no Ready condition reported yet, needs a look). A cordoned Node that is Ready is a choice and does not fail. */
export const nodeRule: Rule<NodeRow> = (row) => byRole(row);

/** What a Deployment and a StatefulSet say of their counts: the word of `workloadState`, and the replicas that are ready of those it wants. */
type Counted = KindRow & { readonly status: KindStatus | undefined; readonly ready: Ratio | undefined };

/** Deployments and StatefulSets: Unavailable (an error) and Partially ready (needs a look) fail, with `N of M ready`. A rollout in progress, a pause and a scale to zero are not failures. */
export const workloadRule: Rule<Counted> = (row) => byRole(row, row.ready === undefined ? undefined : readyOf(row.ready));

/** DaemonSets: the same words, over the nodes it wants a Pod on. */
export const daemonSetRule: Rule<DaemonSetRow> = (row) => byRole(row, row.desired === undefined || row.ready === undefined ? undefined : readyOf({ ready: row.ready, total: row.desired }));

/** How long a claim may be Pending before it is failing: the mock's five minutes (k8s-cluster.js:213). Pending is a state in motion until then. */
export const STUCK_AFTER_MS = 5 * 60_000;

/**
 * PersistentVolumeClaims: Lost (an error), and Pending for more than five minutes, which needs a look: it waits for a volume that does not come. The mock keeps the claim's role as progress; a claim that has stopped
 * being on its way is no longer progress, so it is said as attention. A claim that does not say when it was made has not been seen to wait.
 */
export const claimRule: Rule<PersistentVolumeClaimRow> = (row, now) => {
  const failed = byRole(row);
  if (failed !== undefined) {
    return failed;
  }

  return row.status?.word === 'Pending' && row.createdAt !== undefined && now - row.createdAt > STUCK_AFTER_MS ? { word: 'Pending', role: 'attention', extra: 'waiting for a volume' } : undefined;
};

/**
 * The first instant at which a claim that is Pending and not yet failing will be failing, which is when the overview has to look at the claims again with no change in what it holds (time is the only thing that
 * turns them). Nothing when no claim is waiting its turn: one that fails already is on the page, and one that is not Pending does not change with time.
 */
export function nextStuck(rows: readonly PersistentVolumeClaimRow[], now: number): number | undefined {
  let next: number | undefined;
  for (const { status, createdAt } of rows) {
    if (status?.word !== 'Pending' || createdAt === undefined) {
      continue;
    }

    const turns = createdAt + STUCK_AFTER_MS + 1;
    if (turns > now && (next === undefined || turns < next)) {
      next = turns;
    }
  }

  return next;
}

/** A read the user may not make, or that failed. */
export type Problem = {
  /** The user may not list the kind: asking again cannot change it. */
  readonly denied: boolean;
  /** Why, in words a person reads: the plugin's own sentence for a refusal, and for a failure the words the lists say. */
  readonly cause: string;
  /** Asks again (the view's own retry). Absent where asking again cannot help: a refusal, a connection that is gone. */
  readonly retry: (() => Promise<void>) | undefined;
};

/** What one kind's read says, as the overview reads it. */
export type Observation = {
  readonly kind: KindWords;
  /** The cluster serves the kind. A kind it does not serve is not mentioned. */
  readonly served: boolean;
  /** How many objects are here: the first set, or the whole set. */
  readonly loaded: number;
  /** Whether `loaded` is every object of the kind. */
  readonly complete: boolean;
  /** What the first page says the kind holds, until the whole set is here. */
  readonly said: Count | undefined;
  /** The read that failed or was refused. The rows that were read stay beside it. */
  readonly problem: Problem | undefined;
  /** The objects that fail, in the order of the rows. */
  readonly failing: readonly Failing[];
};

/**
 * The objects of `rows` that fail by `rule` at the instant `now`, in the order of the rows. It is the one part of reading a kind that costs by the number of its objects (a cluster has thousands of Pods), so the page
 * keeps it between renders and does it again only when the rows or the instant change.
 */
export function failingOf<TRow extends KindRow>(rows: readonly TRow[], rule: Rule<TRow> | undefined, now: number): readonly Failing[] {
  if (rule === undefined) {
    return [];
  }

  return rows.flatMap((row): Failing[] => {
    const verdict = rule(row, now);
    return verdict === undefined ? [] : [{ name: row.name, namespace: row.namespace, word: verdict.word, role: verdict.role, extra: verdict.extra }];
  });
}

/**
 * One kind's read, as the overview says it: whether the kind is served, how many objects are here and whether they are all of them, what failed to be read and why, and which of the objects fail by the kind's
 * `rule` at the instant `now`. The words of a failure are the lists' (`kindListSource`), so that the overview and the list of the same kind say one thing; a refusal is the overview's own sentence, which names no
 * namespace because the overview reads them all. `failing` is `failingOf(view.rows, rule, now)`, which a caller that has it already gives.
 */
export function observe<TRow extends KindRow>(kind: KindWords, view: KindView<TRow>, rule: Rule<TRow> | undefined, now: number, failing: readonly Failing[] = failingOf(view.rows, rule, now)): Observation {
  const served = view.state.kind !== 'unsupported';
  const plural = kind.nouns.other;
  const listed = kindListSource(view, plural, ALL_NAMESPACES).state;
  const refused = view.state.kind === 'denied' || view.failure?.kind === 'denied';
  let problem: Problem | undefined;
  if (served && listed.kind === 'failed') {
    problem = refused
      ? { denied: true, cause: `You don't have permission to list ${plural}.`, retry: undefined }
      : { denied: false, cause: listed.message ?? `${plural} could not be read.`, retry: listed.retry === undefined ? undefined : view.retry };
  }

  return { kind, served, loaded: view.rows.length, complete: view.complete, said: view.complete ? undefined : view.firstCount, problem, failing };
}
