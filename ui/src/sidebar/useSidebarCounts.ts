import { useConnectionReadiness, useResolvedResourceTarget, useResourceTypes, useResources, type AccessRoute, type QueryScope, type ResourceType } from '@omniviewdev/runtime/ui/v1';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { ShellCount } from '../contract/shell';
import { KINDS, kindsOnScreen } from '../kinds';
import { kindFailure } from '../kinds/state';

import { sidebarCount, type SidebarCounts } from './count';
import { getOpenCounts, openKey, subscribeOpenCounts, type OpenCounts } from './openCounts';
import { isNamespaced, scopeConstraint, type NamespaceScope } from './scope';
import { createCountStore, type CountStore } from './store';

// The counts of the sidebar's entries, read through the runtime's own hooks: a count is a page of one of the kind (`useResources` with `pageSize: 1`, no collection), which the plugin's backend answers with
// the page's count (`sourcePage.count`: exact, an estimate, or unknown) and keeps 30 s, at most four at a time. The runtime has no hook that reads a number of kinds, and a hook cannot run in a loop (the number
// of kinds on screen changes with the groups that are open), so the reads go through FOUR SLOTS, the backend's own limit, written out below as four calls of one hook. A store with no React in it (`store.ts`)
// says which kind each slot reads; the slot's hook reads it and says what it answered.
//
// What costs a read is held to what is on screen:
//   - only the kinds of the top level (Nodes, Namespaces), which are always on screen, and of the groups the host says are open (`open`);
//   - only while the connection is connected (a read never connects, plan D4), and only for the kinds the catalog serves;
//   - never for a kind whose list is open (`openCounts.ts`): the list knows the count, live, from its own source, and the sidebar draws that;
//   - a count is read again after REFRESH_MS, and not before, however often the sidebar renders; a group that is collapsed stops its reads (what is in flight is cancelled) and one that is opened again reads
//     only what is not already known;
//   - a kind the user may not list (the read was refused: a 403) is NOT read again on a timer, however long the sidebar stays: only when something asks again, which is its group being opened again, the connection
//     or the namespaces counted changing, or its list having been open (`store.ts`). A 403 asked every minute is noise in the audit log of a cluster, for exactly the users who get one.

export type SidebarCountsInput = {
  /** The id the plugin is installed under, which the host tells a contribution. */
  readonly plugin: string;
  /** The connection to count. Absent while the plugin's connections are on their way, or when it has none: nothing is read. */
  readonly connection: string | undefined;
  /** The ids of the groups that are open on screen (`SidebarContextV1.open`). */
  readonly open: readonly string[];
  /** The namespaces counted. There is no namespace menu yet, so the sidebar counts every namespace; a change of scope reads again what depends on it. */
  readonly scope: NamespaceScope;
};

/** What one slot reads: a kind, in a connection and a scope. The key says which read it is; the rest is what the slot's hook asks for. */
type CountJob = {
  readonly key: string;
  /** The id of the entry the count is drawn on: the page of the kind. */
  readonly page: string;
  /** Where the kind's open list says how many (`openCounts`); undefined when that list's count would be of another scope than this one. */
  readonly live: string | undefined;
  readonly route: AccessRoute;
  readonly type: string;
  readonly scope: QueryScope | undefined;
};

const NO_JOBS: readonly CountJob[] = [];
const NO_COUNTS: SidebarCounts = new Map();
/** The route of a slot that reads nothing. */
const IDLE: AccessRoute = { connection: '' };

/**
 * One job for each kind the catalog serves, in the order of the sidebar. A namespaced kind is read in the scope's namespaces and a kind that lives in no namespace in none (it counts the same in any
 * scope, so a change of scope does not read it again). A list reads every namespace, so its count answers a count of every namespace, and the count of a kind that has no namespace in any scope.
 */
function jobsOf(plugin: string, route: AccessRoute, catalog: readonly ResourceType[], scope: NamespaceScope): readonly CountJob[] {
  return KINDS.flatMap((kind) => {
    const served = catalog.find((candidate) => candidate.type === kind.type);
    if (served === undefined) {
      return [];
    }

    const constraint = isNamespaced(served) ? scopeConstraint(scope) : undefined;
    return [{
      key: JSON.stringify([plugin, route.connection, kind.type, constraint ?? null]),
      page: kind.page,
      live: constraint === undefined ? openKey(plugin, route.connection, kind.type) : undefined,
      route,
      type: kind.type,
      scope: constraint,
    }];
  });
}

/** What each entry draws: its open list's count when the list has one, else what was read, else none. A list that is open and has no number yet leaves what was read before it opened on screen. */
function countsOf(jobs: readonly CountJob[], lists: OpenCounts, answers: ReadonlyMap<string, ShellCount | null>): SidebarCounts {
  if (jobs.length === 0) {
    return NO_COUNTS;
  }

  return new Map(jobs.map((job) => {
    const listed = job.live === undefined ? null : (lists.get(job.live) ?? null);
    return [job.page, listed ?? answers.get(job.key) ?? null];
  }));
}

/**
 * One slot of the pool: reads the kind the store hands it, and says what it answered. The runtime drops a read when nobody observes its request any more, so a slot that is handed on or freed cancels what
 * it was reading, and a free slot reads nothing. A read that answered or failed settles the slot (a count that failed, or was cancelled, draws nothing), and one that was refused (a 403) refuses it, which
 * the store keeps from reading again by the clock: the store records it and hands the slot to the next kind that is due. Called as written below, four times: a hook cannot be called in a loop.
 */
function useCountSlot(store: CountStore<CountJob>, slot: number, pluginID: string): void {
  const job = useSyncExternalStore(store.subscribe, () => store.getSnapshot().slots[slot]);
  const target = useResolvedResourceTarget({ pluginID, route: job?.route ?? IDLE, type: job?.type ?? '', scope: job?.scope, enabled: job !== undefined });
  const request = job === undefined || target.data === undefined ? undefined : { targetId: target.data.targetId, request: { target: target.data.target, pageSize: 1 } };
  const { resources } = useResources({ pluginID, request, collection: false });
  // A target that failed stays in the runtime's cache with its error while it is resolved again, and the attempt on its way may succeed: its old error is not an answer until the attempt ends.
  const error = (target.isFetching ? null : target.error) ?? resources.error;
  const page = resources.data;

  useEffect(() => {
    if (job === undefined) {
      return;
    }

    if (error !== null && error !== undefined) {
      if (kindFailure(error)?.kind === 'denied') {
        store.refuse(slot, job.key);
      } else {
        store.settle(slot, job.key, null);
      }
    } else if (page !== undefined) {
      store.settle(slot, job.key, sidebarCount(page.sourcePage.count));
    }
  }, [store, slot, job, error, page]);
}

/**
 * The counts of the sidebar's entries, by the id of the page each entry opens: a number, an approximate number, or `null` (nothing to draw: not read yet, unknown, refused). The same map until a count
 * changes.
 */
export function useSidebarCounts({ plugin, connection, open, scope }: SidebarCountsInput): SidebarCounts {
  const reading = connection !== undefined;
  const route = useMemo(() => ({ connection: connection ?? '' }), [connection]);
  const readiness = useConnectionReadiness({ pluginID: plugin, connectionID: route.connection, enabled: reading });
  const { resourceTypes } = useResourceTypes({ pluginID: plugin, route, enabled: reading });
  const connected = reading && readiness.phase === 'connected';
  // Nothing is read, and nothing said, before the connection is ready: an old catalog never speaks for a connection the runtime has since replaced.
  const catalog = connected ? resourceTypes.data : undefined;
  const lists = useSyncExternalStore(subscribeOpenCounts, getOpenCounts);

  const jobs = useMemo(() => (catalog === undefined ? NO_JOBS : jobsOf(plugin, route, catalog, scope)), [plugin, route, catalog, scope]);
  const wanted = useMemo(() => {
    const onScreen = kindsOnScreen(open).map((kind) => kind.page);
    return jobs.filter((job) => onScreen.includes(job.page) && !(job.live !== undefined && lists.has(job.live)));
  }, [jobs, open, lists]);

  const [store] = useState(() => createCountStore<CountJob>(Date.now));
  useEffect(() => {
    if (connected) {
      store.want(wanted);
    } else {
      store.reset();
    }
  }, [store, connected, wanted]);
  useEffect(() => () => {
    store.reset();
  }, [store]);

  useCountSlot(store, 0, plugin);
  useCountSlot(store, 1, plugin);
  useCountSlot(store, 2, plugin);
  useCountSlot(store, 3, plugin);

  const answers = useSyncExternalStore(store.subscribe, () => store.getSnapshot().answers);
  return useMemo(() => countsOf(jobs, lists, answers), [jobs, lists, answers]);
}
