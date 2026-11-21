import { useConnectionReadiness, useResolvedResourceTarget, useResourceTypes, useResources, type Count } from '@omniviewdev/runtime/ui/v1';
import { useCallback, useMemo } from 'react';

import { isNamespaced } from '../sidebar/scope';

import type { KindDefinition, KindRow, KindSort } from './definition';
import { sortRows } from './sort';
import { readKindState, type KindFailure, type KindState } from './state';

export const PLUGIN_ID = 'kubernetes';

/**
 * The first set: the rows that paint before the complete snapshot (owner decision A10, plan E10). 256 is the largest page the plugin
 * serves and the runtime's batch size.
 */
export const FIRST_SET = 256;

/**
 * The descriptor the footer takes (MOCK core.js `count`). While the set loads the total is unknown and `loaded` says how many are here
 * (`N Pods loaded`); a complete set is counted by its records.
 */
export type KindCount =
  | { readonly kind: 'exact'; readonly value: string }
  | { readonly kind: 'unknown'; readonly loaded: string };

export type KindView<TRow extends KindRow> = {
  readonly state: KindState;
  /** Set beside rows that are kept: a read failed after rows were shown. Without rows the failure is the `state`. */
  readonly failure: KindFailure | undefined;
  /**
   * The rows to show, already in order: `sort`'s (the page gives none, so the kind's default sort: name ascending, a tie by the host key). While `complete` is false the order is PROVISIONAL: the first set sorted once,
   * then left alone, and once more when the complete set arrives. The host's list page sorts these rows again by the column the person pressed (each column's `sortKey`, `sortKey.ts`) in a stable sort: a tie keeps this order.
   */
  readonly rows: readonly TRow[];
  /** `rows.length`: how many objects are loaded. */
  readonly loaded: number;
  /** The whole set has arrived. Until then the count and the sort order are provisional. */
  readonly complete: boolean;
  readonly count: KindCount;
  /**
   * What the first explicit page says it holds (`sourcePage.count`: exact, an estimate or unknown) while the set is not complete: the number the sidebar draws for a kind whose list is open until the whole
   * set is here, and the rows' own count after that. Absent before the page arrives, once the set is complete (the first page is not read any more) and for a connection that is not connected. A view
   * that has no first page leaves it out.
   */
  readonly firstCount?: Count | undefined;
  /** Whether the kind lives in a namespace, as the catalog says (the namespace is among the type's query dimensions). Not known until the catalog has answered, or for a cluster that does not serve the type. */
  readonly namespaced: boolean | undefined;
  /** The source follows the cluster. */
  readonly live: boolean;
  /** A refresh or a resynchronisation is running on a set that is shown. */
  readonly refreshing: boolean;
  /** Starts the connection. Only the caller decides to call it: a read never connects (plan D4). */
  readonly connect: () => Promise<void>;
  /** Asks again for what failed: the connection check, the catalog, the target, or the collection. */
  readonly retry: () => Promise<void>;
  /** The user's Refresh: the rows stay while the collection is refreshed. */
  readonly refresh: () => Promise<void>;
};

export type UseKindRowsOptions = {
  /** The id the plugin is installed under, which the host tells a contribution; `PLUGIN_ID` when absent. */
  readonly pluginID?: string;
  /** The connection to read. Absent while the plugin's connections are on their way, or when it has none: nothing is read. */
  readonly connectionID: string | undefined;
  /** The order the user chose; the kind's default when absent. */
  readonly sort?: KindSort;
};

const NO_ROWS: readonly never[] = [];

/** The runtime's own errors are the state; a command that fails does not throw into an event handler. The Pod page's read settles its commands the same way. */
export async function settled(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch {
    // The failure is in the hooks' state, where `state` and `failure` read it.
  }
}

/**
 * The objects of a kind in a connection, read through the runtime's fenced hooks only: the catalog, the resolved target of the kind's type, then the collection of
 * its source view (live when the type advertises `sourceUpdates`), exactly as the old table reads them.
 *
 * The collection publishes nothing before its snapshot is complete (`useResources`), which takes 2.5 s at 5,025 Pods. A first explicit
 * page of 256 records is read beside it and shown until the collection completes; both give a record the same key, so the hand-over
 * re-keys nothing. Measured and decided in docs/ui-next/status/1a.2.md.
 */
export function useKindRows<TRow extends KindRow>(kind: KindDefinition<TRow>, { pluginID = PLUGIN_ID, connectionID, sort = kind.list.defaultSort }: UseKindRowsOptions): KindView<TRow> {
  const reading = connectionID !== undefined;
  const route = useMemo(() => ({ connection: connectionID ?? '' }), [connectionID]);
  const readiness = useConnectionReadiness({ pluginID, connectionID: route.connection, enabled: reading });
  const { resourceTypes } = useResourceTypes({ pluginID, route, enabled: reading });
  const served = resourceTypes.data?.find((type) => type.type === kind.type);
  const target = useResolvedResourceTarget({ pluginID, route, type: kind.type, enabled: served !== undefined });
  const request = target.data === undefined ? undefined : { targetId: target.data.targetId, request: { target: target.data.target, pageSize: FIRST_SET } };
  const live = served?.capabilities.some((capability) => capability.operation === 'sourceUpdates') ?? false;

  const collection = useResources({ pluginID, request, collection: true, live });
  const everything = collection.resources.data;
  const firstSet = useResources({ pluginID, request: everything === undefined ? request : undefined, collection: false });

  const connected = readiness.phase === 'connected';
  const records = connected ? (everything ?? firstSet.resources.data)?.records : undefined;
  const complete = connected && everything !== undefined;
  const unordered = records === undefined ? NO_ROWS : kind.model.rows(records);
  const { id, direction } = sort;
  const rows = useMemo(() => sortRows(kind.fields, unordered, { id, direction }), [kind, unordered, id, direction]);

  const { state, failure } = readKindState({
    phase: readiness.phase,
    message: readiness.message,
    catalog: { loaded: resourceTypes.data !== undefined, offersType: served !== undefined, error: resourceTypes.error },
    target: { error: target.error },
    read: { error: collection.resources.error, source: collection.source },
    rows: rows.length,
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
    rows,
    loaded: rows.length,
    complete,
    // The count of the source view is not kept live (an object added after the snapshot left it one short), so a complete set is counted by its records.
    count: complete ? { kind: 'exact', value: String(rows.length) } : { kind: 'unknown', loaded: String(rows.length) },
    // What the first page says it holds, while it is the page that is read: nothing is said for a connection that is not connected, or once the collection is here.
    firstCount: connected && !complete ? firstSet.resources.data?.sourcePage.count : undefined,
    namespaced: served === undefined ? undefined : isNamespaced(served),
    live: collection.isLive,
    refreshing: complete && (collection.resources.isFetching || collection.isSyncing),
    connect,
    retry,
    refresh,
  };
}
