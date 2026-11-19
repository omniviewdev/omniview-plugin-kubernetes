import { useConnectionReadiness, useResolvedResourceTarget, useResourceTypes, useResources, type HostRecord, type QueryScope } from '@omniviewdev/runtime/ui/v1';
import { useCallback, useMemo } from 'react';

import { podDefinition } from '../../pods/data/definition';
import { readPodsState, type PodsFailure, type PodsState } from '../../pods/data/state';
import { FIRST_SET, PLUGIN_ID, settled } from '../../pods/data/usePods';

import { podDetail, type PodDetail } from './object';

// INTERIM (D1b): how the page of one Pod reads it, behind this one file so that it can be swapped.
//
// A single-object read is not in the runtime's curated entry (`@omniviewdev/runtime/ui/v1` offers the catalog, the resolved target and `useResources`: a collection, live when
// the type advertises `sourceUpdates`); `useResource` (a `Get`) is in the runtime's main barrel only, which a new-UI plugin may not import. So the page reads the Pod's NAMESPACE as
// a live collection and picks the record by name. That is the cost: a detail tab holds a watch on the whole namespace, and it is a source view of its own (the list's collection
// is another request, so the two are two views, not one shared). It is correct, though: a Pod deleted while its page is open leaves the collection, and the page says so. A follow-up
// swaps this file to `useResource` when the curated entry has it.

export type PodView = {
  /** The connection and the read, as the Pods list words them (`readPodsState`): `empty` is a complete namespace in which the Pod is not. */
  readonly state: PodsState;
  /** Set beside a Pod that is kept: a read failed after the Pod was shown. Without a Pod the failure is the `state`. */
  readonly failure: PodsFailure | undefined;
  /** The Pod, once its namespace has been read and it is there. It stays while a refresh runs and after a failure that follows it. */
  readonly pod: PodDetail | undefined;
  /** The source follows the cluster. */
  readonly live: boolean;
  /** A refresh or a resynchronisation is running on a Pod that is shown. */
  readonly refreshing: boolean;
  /** Starts the connection. Only the caller decides to call it: a read never connects (plan D4). */
  readonly connect: () => Promise<void>;
  /** Asks again for what failed: the connection check, the catalog, the target, or the collection. */
  readonly retry: () => Promise<void>;
  /** The user's Refresh: the Pod stays while the collection is refreshed. */
  readonly refresh: () => Promise<void>;
};

export type UsePodOptions = {
  /** The id the plugin is installed under, which the host tells a contribution; `PLUGIN_ID` when absent. */
  readonly pluginID?: string;
  /** The connection to read. Absent while the plugin's connections are on their way, or when it has none: nothing is read. */
  readonly connectionID: string | undefined;
  /** The Pod's namespace and name: its identity. Nothing is read while either is empty. */
  readonly namespace: string;
  readonly name: string;
};

/** A record is the Pod when its address says so: the host's identity of the object, not a field of its body. */
function isPod({ record }: HostRecord, namespace: string, name: string): boolean {
  const { address } = record.reference;
  return address.id === name && address.scope.some((entry) => entry.dimension === 'namespace' && entry.value === namespace);
}

/**
 * One Pod of a connection, read through the runtime's fenced hooks only: the catalog, the resolved target of the Pod's namespace, then the collection of its source view, live when
 * the type advertises it. The record is picked from the namespace's complete snapshot, so a Pod that is not in it is not there (`empty`), and one that leaves it later is gone.
 */
export function usePod({ pluginID = PLUGIN_ID, connectionID, namespace, name }: UsePodOptions): PodView {
  const reading = connectionID !== undefined && namespace !== '' && name !== '';
  const route = useMemo(() => ({ connection: connectionID ?? '' }), [connectionID]);
  const readiness = useConnectionReadiness({ pluginID, connectionID: route.connection, enabled: reading });
  const { resourceTypes } = useResourceTypes({ pluginID, route, enabled: reading });
  const podType = resourceTypes.data?.find((type) => type.type === podDefinition.type);
  const scope = useMemo<QueryScope>(() => [{ dimension: 'namespace', match: 'oneOf', values: [namespace] }], [namespace]);
  const target = useResolvedResourceTarget({ pluginID, route, type: podDefinition.type, scope, enabled: podType !== undefined && reading });
  const request = target.data === undefined ? undefined : { targetId: target.data.targetId, request: { target: target.data.target, pageSize: FIRST_SET } };
  const live = podType?.capabilities.some((capability) => capability.operation === 'sourceUpdates') ?? false;

  const collection = useResources({ pluginID, request, collection: true, live });
  const everything = collection.resources.data;
  const connected = readiness.phase === 'connected';
  const records = connected ? everything?.records : undefined;
  const record = useMemo(() => records?.find((host) => isPod(host, namespace, name)), [records, namespace, name]);
  const pod = record === undefined ? undefined : podDetail(record);
  const complete = connected && everything !== undefined;

  const { state, failure } = readPodsState({
    phase: readiness.phase,
    message: readiness.message,
    catalog: { loaded: resourceTypes.data !== undefined, offersPods: podType !== undefined, error: resourceTypes.error },
    target: { error: target.error },
    read: { error: collection.resources.error, source: collection.source },
    rows: pod === undefined ? 0 : 1,
    complete,
  });

  const { connect, retry: retryConnection } = readiness;
  const refetchCatalog = resourceTypes.refetch;
  const refetchTarget = target.refetch;
  const refetchCollection = collection.resources.refetch;
  const catalogFailed = resourceTypes.error !== null && resourceTypes.error !== undefined;
  const targetFailed = target.error !== null && target.error !== undefined;

  const retry = useCallback(
    async () => settled(async () => {
      if (!connected) {
        return retryConnection();
      }

      if (catalogFailed) {
        return refetchCatalog();
      }

      return targetFailed ? refetchTarget() : refetchCollection();
    }),
    [connected, catalogFailed, targetFailed, retryConnection, refetchCatalog, refetchTarget, refetchCollection],
  );
  const refresh = useCallback(async () => settled(async () => refetchCollection()), [refetchCollection]);

  return {
    state,
    failure,
    pod,
    live: collection.isLive,
    refreshing: complete && (collection.resources.isFetching || collection.isSyncing),
    connect,
    retry,
    refresh,
  };
}
