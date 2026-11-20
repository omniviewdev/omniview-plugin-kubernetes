// The React Compiler compiles every module that is not a test file, and takes what a hook reads from a module-level variable for a constant: it would memoize the fakes below on their arguments and never see
// the world they read change. They read the world on purpose (that is what they fake), so this module is not compiled.
'use no memo';

import type { AccessRoute, ConnectionReadinessPhase, Count, HostRecord, HostSourcePage, QueryScope, ResolvedResourceTarget, ResourceType, UseResourcesOptions } from '@omniviewdev/runtime/ui/v1';
import { act } from '@testing-library/react';
import { useEffect, useSyncExternalStore } from 'react';
import { vi } from 'vitest';

// Test support only: nothing in the data layer imports this file. It imports nothing of the plugin's own, so that a test can mock the runtime's module with it (`vi.mock`'s factory imports it while that
// module is being replaced: an import of the plugin's code here would import the runtime's module back).
//
// A fake of the runtime's hooks, for the tests that count REAL reads. The runtime's `useResources` reads a page when a request key appears and drops the read when the last observer of the key goes
// (`gcTime: 0`: a read that is still in flight is cancelled with it, and the data of one that is not is gone). Here the same: a read STARTS when a component observes a request key nobody observes, it
// stays in flight until the test answers it, and it is DROPPED when its last observer leaves. Every read is kept, so a test can say how many were made, of what, and how many were in flight at once.

/** What a read answers: the page's count and records, or the error it failed with. The count is left out for a page that carries none. */
export type Outcome = { readonly count?: Count | undefined; readonly records?: readonly HostRecord[] } | { readonly error: unknown };

export type FakeRead = {
  readonly id: number;
  readonly key: string;
  readonly targetId: string;
  /** The type of the target the read was asked of. */
  readonly type: string;
  readonly pageSize: number;
  readonly collection: boolean;
  /** The connection the read was asked in. */
  readonly connection: string;
  /** How many components observe the read. It is dropped when the last one leaves. */
  observers: number;
  /** `cancelled`: it was dropped while it was in flight. */
  state: 'pending' | 'answered' | 'failed' | 'cancelled';
  page: HostSourcePage | undefined;
  error: unknown;
};

const NAME = { name: 'name', allowEmpty: false };
const NAMESPACE = { name: 'namespace', allowEmpty: false };

/** The kinds that live in no namespace: their catalog type has no namespace among its query dimensions. */
const CLUSTER_SCOPED: Readonly<Record<string, true>> = { Node: true, Namespace: true, PersistentVolume: true, StorageClass: true, IngressClass: true, ClusterRole: true, ClusterRoleBinding: true };

/** What the plugin's catalog says of a kind it serves (`native_catalog.go`): a namespaced type has the namespace and the name for query dimensions, a cluster-scoped one the name. */
export function catalogType(kind: { readonly type: string; readonly kind: string }): ResourceType {
  return {
    type: kind.type,
    displayName: kind.kind,
    identityDimensions: CLUSTER_SCOPED[kind.kind] === true ? [] : [NAMESPACE],
    queryDimensions: CLUSTER_SCOPED[kind.kind] === true ? [NAME] : [NAMESPACE, NAME],
    representations: [],
    capabilities: [{ operation: 'enumerate', scope: [] }],
  };
}

/** The kinds the fake catalog serves to begin with. `fake.reset` is given them. */
let everything: readonly ResourceType[] = [];

type World = {
  phase: ConnectionReadinessPhase;
  connections: readonly { readonly id: string }[];
  connectionsPending: boolean;
  /** The catalog; undefined while it has not answered. */
  types: readonly ResourceType[] | undefined;
};

const initial = (): World => ({ phase: 'connected', connections: [{ id: 'kind-a' }], connectionsPending: false, types: everything });

let world = initial();
let version = 0;
const listeners = new Set<() => void>();

let reads: FakeRead[] = [];
/** The reads that have an observer, by request key. */
let live = new Map<string, FakeRead>();
let peak = 0;
let sequence = 0;
/** What a count read of a type answers, when the test says nothing at the time. */
let scripted = new Map<string, Outcome>();
let targetErrors = new Map<string, { readonly error: unknown; readonly fetching: boolean }>();
const targets = new Map<string, ResolvedResourceTarget>();

const connect = vi.fn(() => Promise.resolve());
const retry = vi.fn(() => Promise.resolve());
const refetch = vi.fn(() => Promise.resolve());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = (): number => version;

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) {
    listener();
  }
}

/** A read of one object: the count read of the sidebar. */
export const isCount = (read: FakeRead): boolean => read.pageSize === 1 && !read.collection;

const inFlight = (): readonly FakeRead[] => reads.filter((read) => read.state === 'pending' && read.observers > 0);

/** What a request key says: the key is the JSON of the request and whether it is a collection (a read of the same key is one read). */
type ReadKey = {
  readonly request: { readonly targetId: string; readonly request: { readonly pageSize: number; readonly target: { readonly type: string; readonly route: { readonly connection: string } } } };
  readonly collection: boolean;
};

function start(key: string): FakeRead {
  // The key is made by `useFakeResources` below from a request; parsing it back is how a read knows what it was asked.
  const { request, collection } = JSON.parse(key) as ReadKey;
  sequence += 1;
  const read: FakeRead = {
    id: sequence,
    key,
    targetId: request.targetId,
    type: request.request.target.type,
    pageSize: request.request.pageSize,
    collection,
    connection: request.request.target.route.connection,
    observers: 0,
    state: 'pending',
    page: undefined,
    error: undefined,
  };
  reads.push(read);
  live.set(key, read);
  return read;
}

/** A component observes a request key. The first observer starts the read; the last one to leave drops it. */
function observe(key: string): () => void {
  const read = live.get(key) ?? start(key);
  read.observers += 1;
  peak = Math.max(peak, inFlight().filter(isCount).length);
  return () => {
    read.observers -= 1;
    if (read.observers === 0) {
      live.delete(key);
      if (read.state === 'pending') {
        read.state = 'cancelled';
      }
    }
  };
}

function useWorld(): void {
  useSyncExternalStore(subscribe, getVersion);
}

function useFakeConnections(_options: { readonly plugin: string }) {
  useWorld();
  return { connections: { data: world.connectionsPending ? undefined : world.connections, isPending: world.connectionsPending } };
}

function useFakeReadiness({ enabled = true }: { readonly pluginID?: string; readonly connectionID: string; readonly enabled?: boolean }) {
  useWorld();
  return { phase: enabled ? world.phase : 'checking', message: undefined, connect, retry };
}

function useFakeResourceTypes({ enabled = true }: { readonly pluginID?: string; readonly route: AccessRoute; readonly enabled?: boolean }) {
  useWorld();
  return { resourceTypes: { data: enabled ? world.types : undefined, error: null, refetch } };
}

function useFakeTarget({ route, type, scope, enabled = true }: { readonly pluginID?: string; readonly route: AccessRoute; readonly type: string; readonly scope?: QueryScope; readonly enabled?: boolean }) {
  useWorld();
  const failure = enabled ? targetErrors.get(type) : undefined;
  const error = failure?.error ?? null;
  // A target that failed stays in the runtime's cache with its error while it is resolved again: `isFetching` is how the hook says the answer is on its way.
  const isFetching = failure?.fetching ?? false;
  const served = enabled && failure === undefined && world.phase === 'connected' && (world.types ?? []).some((candidate) => candidate.type === type);
  if (!served) {
    return { data: undefined, error, isFetching, refetch };
  }

  const targetId = JSON.stringify([route.connection, type, scope ?? null]);
  const target = targets.get(targetId) ?? {
    targetId,
    target: { route, provider: 'kubernetes', authority: 'local:test', type, scope: scope ?? [{ dimension: 'namespace', match: 'any' }], representation: 'kubernetes.object.v1/v1' },
    authority: { continuity: 'connectionLocal', limitations: [] },
    catalogRevision: 'revision-1',
  };
  targets.set(targetId, target);
  return { data: target, error, isFetching, refetch };
}

function useFakeResources({ request, collection = false }: UseResourcesOptions) {
  useWorld();
  const key = request === undefined ? undefined : JSON.stringify({ request, collection });
  useEffect(() => {
    if (key === undefined) {
      return undefined;
    }

    return observe(key);
  }, [key]);

  const read = key === undefined ? undefined : live.get(key);
  return {
    resources: {
      data: read?.state === 'answered' ? read.page : undefined,
      error: read?.state === 'failed' ? read.error : null,
      isPending: read === undefined || read.state === 'pending',
      isFetching: false,
      refetch,
    },
    view: undefined,
    source: undefined,
    isLive: false,
    isSyncing: false,
  };
}

/** The runtime's hooks, as fakes of one world. A test mocks `@omniviewdev/runtime/ui/v1` with them (`vi.mock`, spreading the actual module first) and reads their calls like any other mock's. */
export const hooks = {
  useConnections: vi.fn(useFakeConnections),
  useConnectionReadiness: vi.fn(useFakeReadiness),
  useResourceTypes: vi.fn(useFakeResourceTypes),
  useResolvedResourceTarget: vi.fn(useFakeTarget),
  useResources: vi.fn(useFakeResources),
};

const DEFAULT_COUNT: Outcome = { count: { kind: 'exact', value: '1' } };

function pageOf(outcome: { readonly count?: Count | undefined; readonly records?: readonly HostRecord[] }): HostSourcePage {
  return {
    records: outcome.records ?? [],
    sourcePage: { ...(outcome.count === undefined ? {} : { count: outcome.count }), coverage: { kind: 'complete', paths: [] }, consistency: 'snapshot' },
  } as HostSourcePage;
}

/** The world the fake runtime holds, and the reads it has seen. */
export const fake = {
  /** Back to a connected connection, `kind-a`, that serves every kind it is given, with no read ever made. Call it before each test. */
  reset(kinds: ReadonlyArray<{ readonly type: string; readonly kind: string }>): void {
    everything = kinds.map(catalogType);
    world = initial();
    reads = [];
    live = new Map();
    peak = 0;
    sequence = 0;
    scripted = new Map();
    targetErrors = new Map();
    targets.clear();
    version = 0;
    for (const mock of [connect, retry, refetch, ...Object.values(hooks)]) {
      mock.mockClear();
    }
  },

  /** Changes the world, and tells every component that reads it. Call it inside `act`. */
  set(patch: Partial<World>): void {
    world = { ...world, ...patch };
    notify();
  },

  /** The kinds the catalog serves, from now on. */
  serve(kinds: ReadonlyArray<{ readonly type: string; readonly kind: string }>): void {
    fake.set({ types: kinds.map(catalogType) });
  },

  /** What a count read of the type answers, until the test says otherwise. A page with no `count` carries none. */
  script(type: string, outcome: Outcome): void {
    scripted.set(type, outcome);
  },

  /** The type's target cannot be resolved: the hook says why. With `fetching` it is being resolved again, and the error is the one it failed with before. Call it inside `act` once components are mounted. */
  failTarget(type: string, error: unknown, { fetching = false }: { readonly fetching?: boolean } = {}): void {
    targetErrors.set(type, { error, fetching });
    notify();
  },

  /** The type's target resolves: it has no error any more. */
  clearTarget(type: string): void {
    targetErrors.delete(type);
    notify();
  },

  /** Every read that was started, in the order they started. */
  get reads(): readonly FakeRead[] {
    return reads;
  },

  /** The reads of one object: the sidebar's count reads. */
  counts(): readonly FakeRead[] {
    return reads.filter(isCount);
  },

  /** The reads that are in flight now (observed and not answered), in the order they started. */
  pending(filter: (read: FakeRead) => boolean = () => true): readonly FakeRead[] {
    return inFlight().filter(filter);
  },

  /** The reads that were dropped while they were in flight. */
  cancelled(): readonly FakeRead[] {
    return reads.filter((read) => read.state === 'cancelled');
  },

  /** The most count reads that were in flight at once. */
  get peak(): number {
    return peak;
  },

  /** The connection's `connect`: a read never calls it. */
  connect,

  /** Answers one read, from outside React: call it inside `act`. */
  answer(read: FakeRead, outcome: Outcome = scripted.get(read.type) ?? DEFAULT_COUNT): void {
    if (read.state !== 'pending') {
      throw new Error(`The read of ${read.type} is ${read.state}: it cannot be answered`);
    }

    if ('error' in outcome) {
      read.state = 'failed';
      read.error = outcome.error;
    } else {
      read.state = 'answered';
      read.page = pageOf(outcome);
    }

    notify();
  },

  /** Answers every count read in flight, then those the answers set going, until none is left: the sidebar's reads, a batch of at most four at a time. */
  drain(): void {
    for (let rounds = 0; rounds < 200; rounds += 1) {
      const batch = fake.pending(isCount);
      if (batch.length === 0) {
        return;
      }

      act(() => {
        for (const read of batch) {
          fake.answer(read);
        }
      });
    }

    throw new Error('The count reads never ran out');
  },
};
