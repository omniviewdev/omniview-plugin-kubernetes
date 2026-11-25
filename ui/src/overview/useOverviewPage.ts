import { useConnectionMetadata, useConnectionReadiness } from '@omniviewdev/runtime/ui/v1';
import { useEffect, useMemo } from 'react';

import { connectionFace, NO_CONNECTIONS_TEXT, useChosenConnection } from '../connection';
import type { ContextV1, DetailPageViewV1, DetailSource, DetailState } from '../contract/v1';
import { cronJobDefinition } from '../kinds/cronjobs/definition';
import { daemonSetDefinition } from '../kinds/daemonsets/definition';
import type { KindRow } from '../kinds/definition';
import { deploymentDefinition } from '../kinds/deployments/definition';
import { jobDefinition } from '../kinds/jobs/definition';
import { namespaceDefinition } from '../kinds/namespaces/definition';
import { nodeDefinition } from '../kinds/nodes/definition';
import { nodeIsReady } from '../kinds/nodes/row';
import { persistentVolumeClaimDefinition } from '../kinds/persistentvolumeclaims/definition';
import { podDefinition } from '../kinds/pods/definition';
import { statefulSetDefinition } from '../kinds/statefulsets/definition';
import { settled, useKindRows, type KindView } from '../kinds/useKindRows';

import { claimRule, daemonSetRule, failingOf, jobRule, nextStuck, nodeRule, observe, podRule, workloadRule, type KindWords, type Observation, type Rule } from './assess';
import { readFacts } from './facts';
import { overviewModel } from './model';
import { pageState } from './state';
import { useNow } from './useNow';
import { overviewView } from './view';

// The overview's one data hook (the contribution contract's `usePage` of an overview page): which connection it reads, the kinds it reads, the connection's facts, and the state it hands the host. The host calls it
// inside the page's own error boundary and draws what it returns: the lane's face, and the source of the page, which is the connection's state and, while the connection is ready, the view.
//
// It reads through the fenced hooks and nothing else (`kinds/README.md`, rule 2). Each kind is `useKindRows`, the hook the lists read with: the catalog, the resolved target, then the collection of its source view, live when
// the type advertises it, with a first page of 256 beside it that is shown until the collection completes. The runtime has no hook that reads several kinds, and a hook cannot run in a loop, so the nine kinds the page
// reads are nine calls written out, as the sidebar's four slots are (`sidebar/useSidebarCounts.ts`). What that costs is nine collections, and a first page for each until it has answered: the reads of nine lists open
// at once, none of them a read or a watch a list does not already make. A page that is not on screen holds none of them: the host mounts this hook with the page, and the runtime drops a read when its last observer goes.
// The facts are `useConnectionMetadata`, which reads the connection's own facts, never connects it and never acquires one.
//
// A connection is never started by a read, so this page starts the one it finds stopped, once, as the lists do: a development shortcut that 1a.7 removes in favour of an explicit Connect (plan D4).

/** The connections are on their way: the page is loading, with nothing to say. */
const WAITING: DetailState = { kind: 'loading' };
/** The plugin has no connection (or is not installed): there is nothing to read, and nothing to retry. The words the lists say. */
const NO_CONNECTIONS: DetailState = { kind: 'failed', message: NO_CONNECTIONS_TEXT };
const READY: DetailState = { kind: 'ready' };

/**
 * What one kind says, for the page: what failed in its rows, kept between renders (the rows are the one thing that grows with the cluster, and the page renders again for every read that answers), and the rest of
 * what its read says. A hook, so that it is called as written below, for each kind and in the same order.
 */
function useObservation<TRow extends KindRow>(kind: KindWords, view: KindView<TRow>, rule: Rule<TRow> | undefined, now: number): Observation {
  const { rows } = view;
  const failing = useMemo(() => failingOf(rows, rule, now), [rows, rule, now]);
  return observe(kind, view, rule, now, failing);
}

export function useOverviewPage({ plugin, route }: ContextV1): DetailPageViewV1 {
  const connection = useChosenConnection(plugin, route.connection);
  const connectionID = connection.chosen?.id;
  const readiness = useConnectionReadiness({ pluginID: plugin, connectionID: connectionID ?? '', enabled: connectionID !== undefined });
  const { phase, message, connect, retry } = readiness;
  const connected = connectionID !== undefined && phase === 'connected';

  useEffect(() => {
    if (connectionID !== undefined && phase === 'disconnected') {
      void connect();
    }
  }, [connectionID, phase, connect]);

  const options = { pluginID: plugin, connectionID };
  const pods = useKindRows(podDefinition, options);
  const deployments = useKindRows(deploymentDefinition, options);
  const statefulSets = useKindRows(statefulSetDefinition, options);
  const daemonSets = useKindRows(daemonSetDefinition, options);
  const jobs = useKindRows(jobDefinition, options);
  const cronJobs = useKindRows(cronJobDefinition, options);
  const claims = useKindRows(persistentVolumeClaimDefinition, options);
  const nodes = useKindRows(nodeDefinition, options);
  const namespaces = useKindRows(namespaceDefinition, options);
  // The facts of a connection are read for one that is connected: a stopped connection has none to say, and a read of them never starts it.
  const metadata = useConnectionMetadata({ pluginID: plugin, connectionID, enabled: connected });

  // A claim is failing when it has waited long enough, and nothing in the data says when that is: the page looks again at the instant the first one that waits will have.
  const now = useNow((at) => nextStuck(claims.rows, at));
  const inputs = {
    pods: useObservation(podDefinition, pods, podRule, now),
    deployments: useObservation(deploymentDefinition, deployments, workloadRule, now),
    statefulSets: useObservation(statefulSetDefinition, statefulSets, workloadRule, now),
    daemonSets: useObservation(daemonSetDefinition, daemonSets, daemonSetRule, now),
    jobs: useObservation(jobDefinition, jobs, jobRule, now),
    cronJobs: useObservation(cronJobDefinition, cronJobs, undefined, now),
    claims: useObservation(persistentVolumeClaimDefinition, claims, claimRule, now),
    nodes: useObservation(nodeDefinition, nodes, nodeRule, now),
    namespaces: useObservation(namespaceDefinition, namespaces, undefined, now),
  };
  const nodeRows = nodes.rows;
  const nodesReady = useMemo(() => nodeRows.filter(nodeIsReady).length, [nodeRows]);

  // The state is the connection's: a connection that is not ready replaces the body, and a read that failed is a row of Needs attention, because one kind that cannot be listed is not a page that cannot be drawn.
  const retryConnection = () => {
    void settled(retry);
  };
  const state = connection.chosen === undefined ? (connection.pending ? WAITING : NO_CONNECTIONS) : (pageState(phase, message, retryConnection) ?? READY);

  // Refresh re-reads every source the page holds. A read that failed is asked again from where it failed (the catalog, the target or the collection); the others refresh their collection.
  const reads = [
    { view: pods, observation: inputs.pods },
    { view: deployments, observation: inputs.deployments },
    { view: statefulSets, observation: inputs.statefulSets },
    { view: daemonSets, observation: inputs.daemonSets },
    { view: jobs, observation: inputs.jobs },
    { view: cronJobs, observation: inputs.cronJobs },
    { view: claims, observation: inputs.claims },
    { view: nodes, observation: inputs.nodes },
    { view: namespaces, observation: inputs.namespaces },
  ];
  const { snapshot } = metadata;
  const refresh = async (): Promise<void> => {
    await Promise.all([...reads.map(({ view, observation }) => (observation.problem?.retry ?? view.refresh)()), settled(async () => metadata.refresh())]);
  };
  // The facts are refreshing while a refresh runs on facts that are on screen; the first observation of a connection is not a refresh of anything.
  const refreshing = reads.some(({ view }) => view.refreshing) || (snapshot?.refreshing === true && Object.keys(snapshot.entries).length > 0);

  const source: DetailSource = {
    state,
    view: state.kind === 'ready' ? overviewView(overviewModel({ ...inputs, nodesReady, facts: readFacts(metadata) })) : undefined,
    refreshing,
    refresh,
  };
  // The lane is declared from the first render, whatever is not known yet (`connectionFace`): the connection the page reads. The overview reads every namespace and has no namespace of its own to say.
  return { scope: [connectionFace(connection)], source };
}
