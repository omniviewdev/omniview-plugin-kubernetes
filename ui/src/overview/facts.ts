import type { ConnectionMetadataState, ConnectionMetadataValue } from '@omniviewdev/runtime/ui/v1';

import { timeOf } from '../kinds/fields';

// The facts the plugin's backend publishes about a connection, read through `useConnectionMetadata`: the server's version and address, which provider and distribution it is, and the API groups that did not answer
// (`pkg/plugin/resource/connection_metadata.go`, `connection_environment.go`, `native_catalog_heal.go:124-170`). Each is an observation with a state the backend gives it: current, stale (the last value, and when it was
// read) or unavailable (it could not be observed, with the code why). A page that draws one says which it has. A value that is not current is never drawn as current, and one that cannot be read says so: no fact becomes
// a dash, a zero or a guess.

/** The keys the backend publishes the facts under. */
export const KEYS = {
  version: 'kubernetes.server_version',
  url: 'kubernetes.server_url',
  provider: 'kubernetes.provider',
  distribution: 'kubernetes.distribution',
  groups: 'kubernetes.unavailable_api_groups',
} as const;

export type Fact =
  /** Observed on an active connection whose facts are watched. */
  | { readonly state: 'current'; readonly value: ConnectionMetadataValue }
  /** The last value, which is not known to still hold: the backend says so, the connection is stopped, or the watch is down. `observedAt` is when it was read, in epoch milliseconds, when that is a time. */
  | { readonly state: 'stale'; readonly value: ConnectionMetadataValue; readonly observedAt: number | undefined }
  /** On its way: the backend has not answered, or its first observation is running. */
  | { readonly state: 'loading' }
  /** The connection's facts are all here and this one is not among them: the backend leaves out a fact that does not apply, and a server may report none. */
  | { readonly state: 'absent' }
  /** It cannot be read: the backend could not observe it (`code` says why), or the facts cannot be read at all (no `code`). */
  | { readonly state: 'unreadable'; readonly code: string | undefined };

/** What `useConnectionMetadata` answers, less the command: the part a fact is read from. */
export type MetadataRead = Pick<ConnectionMetadataState, 'supported' | 'transportAvailable' | 'snapshot' | 'isLoading' | 'error'>;

/**
 * The state of one fact. An entry the backend calls current is current only while the connection is active and its facts are watched: a stopped connection observes nothing, and a watch that is down says nothing
 * of what changed, so the value is then the last one read, which is how the host's own helper treats it (`readCurrentConnectionMetadataString`).
 */
export function readFact(read: MetadataRead, key: string): Fact {
  const { snapshot, transportAvailable, supported } = read;
  if (snapshot === undefined) {
    // Nothing was read. The facts are on their way, unless the backend publishes none, the read failed, or the watch that carries them is down.
    return supported === false || read.error !== undefined || (supported === true && !transportAvailable) ? { state: 'unreadable', code: undefined } : { state: 'loading' };
  }

  const entry = snapshot.entries[key];
  if (entry === undefined) {
    // A connection's first observation publishes an empty snapshot that is refreshing. After that a fact that is not there is one the backend removed, or never had.
    return snapshot.refreshing && Object.keys(snapshot.entries).length === 0 ? { state: 'loading' } : { state: 'absent' };
  }

  switch (entry.state) {
    case 'unavailable':
      return { state: 'unreadable', code: entry.error.code };
    case 'stale':
      return { state: 'stale', value: entry.value, observedAt: timeOf(entry.observedAt) };
    case 'current':
      return snapshot.active && transportAvailable ? { state: 'current', value: entry.value } : { state: 'stale', value: entry.value, observedAt: timeOf(entry.observedAt) };
  }
}

/** The facts the overview says. */
export type Facts = { readonly [Name in keyof typeof KEYS]: Fact };

export function readFacts(read: MetadataRead): Facts {
  return {
    version: readFact(read, KEYS.version),
    url: readFact(read, KEYS.url),
    provider: readFact(read, KEYS.provider),
    distribution: readFact(read, KEYS.distribution),
    groups: readFact(read, KEYS.groups),
  };
}

/** The API groups that did not answer, as the backend publishes them: how many, and the first names (`group/version`; the backend lists at most 32, and counts the rest). */
export type Groups = { readonly count: number; readonly names: readonly string[] };

/**
 * The value of the unavailable-groups fact: `{ count, groups: [{ groupVersion, reason }] }`. Nothing for a value that has no count that is a positive whole number, which the backend never writes: a fact it did not write
 * is not read as the nearest thing. A name that cannot be read is left out, and the count is what the backend said.
 */
export function groupsOf(value: ConnectionMetadataValue): Groups | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const { count, groups } = value;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) {
    return undefined;
  }

  const names = Array.isArray(groups)
    ? groups.flatMap((group) => (typeof group === 'object' && group !== null && !Array.isArray(group) && typeof group.groupVersion === 'string' && group.groupVersion !== '' ? [group.groupVersion] : []))
    : [];
  return { count, names };
}

// How a provider and a distribution spell themselves: the clouds in capitals, the local clusters as their projects write them. A name the backend gives that is not here is said as it was given. The key comes from the
// backend, so the tables are Maps (as `kinds/status.ts` holds its words): a plain object would answer a key like `constructor` with a function of its prototype.
const PROVIDERS = new Map([['eks', 'EKS'], ['gke', 'GKE'], ['aks', 'AKS'], ['kind', 'kind'], ['k3d', 'k3d'], ['minikube', 'minikube'], ['docker-desktop', 'Docker Desktop']]);
const DISTRIBUTIONS = new Map([['eks', 'EKS'], ['gke', 'GKE'], ['k3s', 'k3s'], ['rke2', 'RKE2'], ['openshift', 'OpenShift']]);

/** `kubernetes.provider` in the words a person reads: `eks` is `EKS`, `docker-desktop` is `Docker Desktop`. */
export const providerWords = (key: string): string => PROVIDERS.get(key) ?? key;

/** `kubernetes.distribution` in the words a person reads: `rke2` is `RKE2`. */
export const distributionWords = (key: string): string => DISTRIBUTIONS.get(key) ?? key;
