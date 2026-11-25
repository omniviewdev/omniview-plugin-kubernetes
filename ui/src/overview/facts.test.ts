import type { ConnectionMetadataEntry, ConnectionMetadataSnapshot, ConnectionMetadataValue } from '@omniviewdev/runtime/ui/v1';
import { describe, expect, it } from 'vitest';

import { KEYS, distributionWords, groupsOf, providerWords, readFact, readFacts, type MetadataRead } from './facts';

// The facts the plugin's backend publishes about a connection (`pkg/plugin/resource/connection_metadata.go`, `native_catalog_heal.go:124-170`), read through `useConnectionMetadata`. Each is an observation with a
// state, and a page that draws one says which of the three it has: a fact that is not current is never drawn as current, and one that cannot be read says so and never draws a dash for it.

const OBSERVED = '2026-11-25T11:56:00Z';

const current = (value: ConnectionMetadataValue): ConnectionMetadataEntry => ({ state: 'current', value, observedAt: OBSERVED });

function snapshotOf(entries: Record<string, ConnectionMetadataEntry>, over: Partial<ConnectionMetadataSnapshot> = {}): ConnectionMetadataSnapshot {
  return { connectionID: 'kind-a', generation: 'g1', revision: '3', active: true, refreshing: false, entries, ...over };
}

/** What `useConnectionMetadata` answers once the connection's facts have been read. */
const read = (entries: Record<string, ConnectionMetadataEntry> = {}, over: Partial<MetadataRead> = {}, snapshot: Partial<ConnectionMetadataSnapshot> = {}): MetadataRead =>
  ({ supported: true, transportAvailable: true, isLoading: false, snapshot: snapshotOf(entries, snapshot), ...over });

describe('readFact: the state of one fact', () => {
  it('is current when the connection is active and the facts are watched: the value', () => {
    expect(readFact(read({ [KEYS.version]: current('v1.35.0') }), KEYS.version)).toEqual({ state: 'current', value: 'v1.35.0' });
  });

  it('is stale, with the instant it was last read, when the backend says so', () => {
    const entry: ConnectionMetadataEntry = { state: 'stale', value: 'v1.35.0', observedAt: OBSERVED, error: { code: 'OBSERVATION_FAILED', message: 'Connection metadata could not be refreshed.' } };

    expect(readFact(read({ [KEYS.version]: entry }), KEYS.version)).toEqual({ state: 'stale', value: 'v1.35.0', observedAt: Date.parse(OBSERVED) });
  });

  it('is stale, and no instant, when the time it was last read is not a time: the value is still not current', () => {
    const entry: ConnectionMetadataEntry = { state: 'stale', value: 'v1.35.0', observedAt: 'yesterday' };

    expect(readFact(read({ [KEYS.version]: entry }), KEYS.version)).toEqual({ state: 'stale', value: 'v1.35.0', observedAt: undefined });
  });

  it('is stale when the entry says current and the connection is not active: a stopped connection observes nothing, whatever the entry still says (the host\'s own rule for a decision)', () => {
    expect(readFact(read({ [KEYS.version]: current('v1.35.0') }, {}, { active: false }), KEYS.version)).toEqual({ state: 'stale', value: 'v1.35.0', observedAt: Date.parse(OBSERVED) });
  });

  it('is stale when the entry says current and the watch is down: nothing says it still is', () => {
    expect(readFact(read({ [KEYS.version]: current('v1.35.0') }, { transportAvailable: false }), KEYS.version)).toMatchObject({ state: 'stale', value: 'v1.35.0' });
  });

  it('is unreadable, with the code the backend gave, when the backend could not observe it', () => {
    const entry: ConnectionMetadataEntry = { state: 'unavailable', error: { code: 'NOT_REPORTED', message: 'The server did not report this fact.' } };

    expect(readFact(read({ [KEYS.url]: entry }), KEYS.url)).toEqual({ state: 'unreadable', code: 'NOT_REPORTED' });
  });

  it('is absent when the connection\'s facts are all here and this one is not among them: the backend removes a fact that does not apply (no group is unavailable)', () => {
    expect(readFact(read({ [KEYS.version]: current('v1.35.0') }), KEYS.groups)).toEqual({ state: 'absent' });
  });

  it('is on its way while the first observation runs: the snapshot has no fact yet, and says it is refreshing', () => {
    expect(readFact(read({}, {}, { refreshing: true }), KEYS.version)).toEqual({ state: 'loading' });
  });

  it('is absent, not on its way, when a later refresh runs and the snapshot has other facts: what it said before still stands', () => {
    expect(readFact(read({ [KEYS.version]: current('v1.35.0') }, {}, { refreshing: true }), KEYS.groups)).toEqual({ state: 'absent' });
  });
});

describe('readFact: before the connection\'s facts have been read', () => {
  const none = (over: Partial<MetadataRead>): MetadataRead => ({ supported: undefined, transportAvailable: false, isLoading: false, snapshot: undefined, ...over });

  it('is on its way while the hook has not heard from the backend, and while it asks', () => {
    expect(readFact(none({}), KEYS.version)).toEqual({ state: 'loading' });
    expect(readFact(none({ supported: true, transportAvailable: true, isLoading: true }), KEYS.version)).toEqual({ state: 'loading' });
  });

  it('cannot be read when the backend publishes no facts, when the read failed, and when the watch is down with nothing to show', () => {
    expect(readFact(none({ supported: false }), KEYS.version)).toEqual({ state: 'unreadable', code: undefined });
    expect(readFact(none({ supported: true, error: new Error('boom') }), KEYS.version)).toEqual({ state: 'unreadable', code: undefined });
    expect(readFact(none({ supported: true, transportAvailable: false }), KEYS.version)).toEqual({ state: 'unreadable', code: undefined });
  });
});

describe('readFacts: the five facts the overview says', () => {
  it('reads each under its key: the server version and address, the provider and distribution, and the API groups that did not answer', () => {
    const facts = readFacts(read({
      [KEYS.version]: current('v1.31.4-eks-aeac579'),
      [KEYS.url]: current('https://ABC.gr7.eu-west-1.eks.amazonaws.com'),
      [KEYS.provider]: current('eks'),
      [KEYS.distribution]: current('eks'),
    }));

    expect(facts).toEqual({
      version: { state: 'current', value: 'v1.31.4-eks-aeac579' },
      url: { state: 'current', value: 'https://ABC.gr7.eu-west-1.eks.amazonaws.com' },
      provider: { state: 'current', value: 'eks' },
      distribution: { state: 'current', value: 'eks' },
      groups: { state: 'absent' },
    });
  });

  it('names the keys the backend publishes them under', () => {
    expect(KEYS).toEqual({
      version: 'kubernetes.server_version',
      url: 'kubernetes.server_url',
      provider: 'kubernetes.provider',
      distribution: 'kubernetes.distribution',
      groups: 'kubernetes.unavailable_api_groups',
    });
  });
});

describe('groupsOf: the value of the fact that names the API groups that did not answer', () => {
  it('is how many do not answer and the first names the backend lists, as `group/version`', () => {
    const value = { count: 40, groups: [{ groupVersion: 'metrics.k8s.io/v1beta1', reason: 'the server is currently unable to handle the request' }, { groupVersion: 'custom.metrics.k8s.io/v1beta1', reason: 'x' }] };

    expect(groupsOf(value)).toEqual({ count: 40, names: ['metrics.k8s.io/v1beta1', 'custom.metrics.k8s.io/v1beta1'] });
  });

  it('keeps the count when no name can be read: the number is still what the backend said', () => {
    expect(groupsOf({ count: 2 })).toEqual({ count: 2, names: [] });
    expect(groupsOf({ count: 2, groups: [{ groupVersion: 3 }, 'x', null, { groupVersion: '' }, { groupVersion: 'a/v1' }] })).toEqual({ count: 2, names: ['a/v1'] });
  });

  it('is nothing when there is no count that is a positive whole number: nothing is made up', () => {
    for (const value of [null, 'x', 3, [], {}, { count: 0 }, { count: -1 }, { count: 1.5 }, { count: '2' }, { groups: [{ groupVersion: 'a/v1' }] }]) {
      expect(groupsOf(value as never), JSON.stringify(value)).toBeUndefined();
    }
  });
});

describe('the provider and the distribution, in the words a person reads', () => {
  it('says the clouds and the local clusters as they spell themselves', () => {
    expect(['eks', 'gke', 'aks', 'kind', 'k3d', 'minikube', 'docker-desktop'].map(providerWords)).toEqual(['EKS', 'GKE', 'AKS', 'kind', 'k3d', 'minikube', 'Docker Desktop']);
    expect(['eks', 'gke', 'k3s', 'rke2', 'openshift'].map(distributionWords)).toEqual(['EKS', 'GKE', 'k3s', 'RKE2', 'OpenShift']);
  });

  it('says a name it does not know as the backend gave it: nothing is invented', () => {
    expect(providerWords('civo')).toBe('civo');
    expect(distributionWords('talos')).toBe('talos');
  });
});
