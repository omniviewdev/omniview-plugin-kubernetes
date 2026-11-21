import { useConnectionReadiness, useResolvedResourceTarget, useResourceTypes, useResources, type HostRecord, type QueryScope } from '@omniviewdev/runtime/ui/v1';
import { useCallback, useMemo, useState } from 'react';

import type { KindDetail } from '../definition';
import { readKindState, type KindFailure, type KindState } from '../state';
import { FIRST_SET, PLUGIN_ID, settled } from '../useKindRows';

// How the page of one object reads it, for every kind, behind this one file: by its namespace (a kind that lives in one) and its name. It is the Pod page's read (`pod/data/usePod.ts`), generalised.
//
// The plugin's catalog declares `name` as a query dimension of every native kind, beside the namespace of a namespaced one, so the resolved target is the object itself: `{ namespace oneOf [ns], name oneOf
// [name] }`, or `{ name oneOf [name] }` for a kind that lives in no namespace, which has no namespace dimension. The plugin has the API server do the narrowing (a `metadata.name` field selector on the LIST
// and on the WATCH), so the source view of a detail tab holds that one record and its cost does not grow with the namespace. The view is live when the type advertises `sourceUpdates`, so an object
// deleted while its page is open leaves the view and the page says so. A single `Get` is not the read: it is one-shot, nothing tells it an object was deleted, and the runtime's curated entry does
// not offer it.

export type KindObjectView = {
  /** The connection and the read, as the lists word them (`readKindState`): `empty` is the object's own complete snapshot, which has no such object. */
  readonly state: KindState;
  /** Set beside an object that is kept: a read failed after the object was shown. Without an object the failure is the `state`. */
  readonly failure: KindFailure | undefined;
  /** The record of the object, once its source view has a complete snapshot and the object is in it. It stays while a refresh runs and after a failure that follows it. */
  readonly record: HostRecord | undefined;
  /** The page has shown this object and its source has since said it is gone: it was deleted while its page was open. False for an object the page never had, which is not found, and while the read is anything but a complete snapshot without it. */
  readonly deleted: boolean;
  /** The source follows the cluster. */
  readonly live: boolean;
  /** A refresh or a resynchronisation is running on an object that is shown. */
  readonly refreshing: boolean;
  /** Starts the connection. Only the caller decides to call it: a read never connects (plan D4). */
  readonly connect: () => Promise<void>;
  /** Asks again for what failed: the connection check, the catalog, the target, or the collection. */
  readonly retry: () => Promise<void>;
  /** The user's Refresh: the object stays while the collection is refreshed. */
  readonly refresh: () => Promise<void>;
};

export type UseKindObjectOptions = {
  /** The id the plugin is installed under, which the host tells a contribution; `PLUGIN_ID` when absent. */
  readonly pluginID?: string;
  /** The connection to read. Absent while the plugin's connections are on their way, or when it has none: nothing is read. */
  readonly connectionID: string | undefined;
  /** The object's identity, from its route. The namespace is read only for a kind that lives in one (`KindDetail.identity`); nothing is read while a part of the identity is empty. */
  readonly namespace: string | undefined;
  readonly name: string;
};

/** A record is the object when its address says so: the host's identity of the object, not a field of its body. The view holds that one record; the check keeps the page from showing another object should a view ever hold more. */
function isTheObject({ record }: HostRecord, inNamespace: boolean, namespace: string | undefined, name: string): boolean {
  const { address } = record.reference;
  return address.id === name && (!inNamespace || address.scope.some((entry) => entry.dimension === 'namespace' && entry.value === namespace));
}

/**
 * One object of a connection, read through the runtime's fenced hooks only: the catalog, the resolved target of that one object, then the collection of its source view, live when the type
 * advertises it. The collection is the object's own complete snapshot, so an object that is not in it is not there (`empty`), and one that leaves it later is gone.
 */
export function useKindObject(kind: { readonly type: string; readonly detail: Pick<KindDetail, 'identity'> }, { pluginID = PLUGIN_ID, connectionID, namespace, name }: UseKindObjectOptions): KindObjectView {
  const inNamespace = kind.detail.identity.length === 2;
  const reading = connectionID !== undefined && name !== '' && (!inNamespace || (namespace !== undefined && namespace !== ''));
  const route = useMemo(() => ({ connection: connectionID ?? '' }), [connectionID]);
  const readiness = useConnectionReadiness({ pluginID, connectionID: route.connection, enabled: reading });
  const { resourceTypes } = useResourceTypes({ pluginID, route, enabled: reading });
  const served = resourceTypes.data?.find((type) => type.type === kind.type);
  const scope = useMemo<QueryScope>(
    () => [...(inNamespace ? [{ dimension: 'namespace', match: 'oneOf' as const, values: [namespace ?? ''] }] : []), { dimension: 'name', match: 'oneOf' as const, values: [name] }],
    [inNamespace, namespace, name],
  );
  const target = useResolvedResourceTarget({ pluginID, route, type: kind.type, scope, enabled: served !== undefined && reading });
  const request = target.data === undefined ? undefined : { targetId: target.data.targetId, request: { target: target.data.target, pageSize: FIRST_SET } };
  const live = served?.capabilities.some((capability) => capability.operation === 'sourceUpdates') ?? false;

  const collection = useResources({ pluginID, request, collection: true, live });
  const everything = collection.resources.data;
  const connected = readiness.phase === 'connected';
  const records = connected ? everything?.records : undefined;
  const record = useMemo(() => records?.find((host) => isTheObject(host, inNamespace, namespace, name)), [records, inNamespace, namespace, name]);
  // What the page has shown: an object that leaves its source view after it was on this page was deleted, and one that never was there was never found. The memory is of this object alone: a route that moves to another starts it again.
  const identity = `${connectionID ?? ''}\n${namespace ?? ''}\n${name}`;
  const [shown, setShown] = useState<string | undefined>(undefined);
  if (shown !== identity && (record !== undefined || shown !== undefined)) {
    setShown(record === undefined ? undefined : identity);
  }
  const complete = connected && everything !== undefined;

  const { state, failure } = readKindState({
    phase: readiness.phase,
    message: readiness.message,
    catalog: { loaded: resourceTypes.data !== undefined, offersType: served !== undefined, error: resourceTypes.error },
    target: { error: target.error },
    read: { error: collection.resources.error, source: collection.source },
    rows: record === undefined ? 0 : 1,
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
    record,
    deleted: state.kind === 'empty' && shown === identity,
    live: collection.isLive,
    refreshing: complete && (collection.resources.isFetching || collection.isSyncing),
    connect,
    retry,
    refresh,
  };
}
