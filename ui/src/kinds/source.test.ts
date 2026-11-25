import { describe, expect, it, vi } from 'vitest';

import { ALL_NAMESPACES, type NamespaceScope } from '../sidebar/scope';

import type { PodRow } from './pods/row';
import { connectionSentence, kindListSource } from './source';
import type { KindFailure as PodsFailure, KindState as PodsState } from './state';
import type { KindView } from './useKindRows';

type PodsView = KindView<PodRow>;

/** The mapping for the Pods list: the words of a failure name the kind in the plural. A list reads every namespace (there is no namespace menu yet). */
const podsListSource = (pods: PodsView) => kindListSource(pods, 'Pods', ALL_NAMESPACES);

// A view as `useKindRows` hands it over; only what the mapping reads is real.
function view(over: Partial<PodsView> & { readonly state: PodsState }): PodsView {
  return {
    failure: undefined,
    rows: [],
    loaded: 0,
    complete: false,
    count: { kind: 'unknown', loaded: '0' },
    live: false,
    refreshing: false,
    namespaced: true,
    connect: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    ...over,
  };
}

describe('kindListSource: the rows and what the page asks of them pass through', () => {
  it('hands over the rows, whether the set is complete, whether a refresh runs, and the user\'s Refresh', () => {
    const refresh = vi.fn(async () => undefined);
    const rows = [{ key: 'a' }] as unknown as PodsView['rows'];
    const source = podsListSource(view({ state: { kind: 'loaded' }, rows, complete: true, refreshing: true, refresh }));
    expect(source.rows).toBe(rows);
    expect(source.complete).toBe(true);
    expect(source.refreshing).toBe(true);
    expect(source.refresh).toBe(refresh);
  });
});

describe('kindListSource: the state of the connection and the read, as the page words it', () => {
  it.each<PodsState>([{ kind: 'connecting' }, { kind: 'disconnected' }, { kind: 'loading' }])('is loading while the state is $kind (a connection is started by the page itself, so there is nothing to wait on but the answer)', (state) => {
    expect(podsListSource(view({ state })).state).toEqual({ kind: 'loading' });
  });

  it('is ready with rows, and ready with the whole set empty', () => {
    expect(podsListSource(view({ state: { kind: 'loaded' } })).state).toEqual({ kind: 'ready' });
    expect(podsListSource(view({ state: { kind: 'empty' }, complete: true })).state).toEqual({ kind: 'ready' });
  });

  it('is failed with the runtime\'s own words and a Retry that asks the view again, for a failure the connection can recover from', () => {
    const retry = vi.fn(async () => undefined);
    const { state } = podsListSource(view({ state: { kind: 'unreachable', message: 'dial tcp: i/o timeout' }, retry }));
    expect(state).toMatchObject({ kind: 'failed', message: 'dial tcp: i/o timeout' });
    if (state.kind !== 'failed') {
      throw new Error('failed expected');
    }

    state.retry?.();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each<[PodsState, string]>([
    [{ kind: 'needs-sign-in' }, 'The connection needs you to sign in.'],
    [{ kind: 'unreachable' }, 'The cluster did not answer.'],
    [{ kind: 'failed' }, 'Pods could not be read.'],
  ])('says in its own words what %j means when the runtime gave none', (state, message) => {
    expect(podsListSource(view({ state })).state).toMatchObject({ kind: 'failed', message });
  });

  it('offers no Retry where asking again cannot help: a cluster that serves no Pods, a connection that is gone', () => {
    const unsupported = podsListSource(view({ state: { kind: 'unsupported' } })).state;
    const gone = podsListSource(view({ state: { kind: 'not-found', message: 'No such connection.' } })).state;
    expect(unsupported).toEqual({ kind: 'failed', message: 'This cluster does not serve Pods.' });
    expect(gone).toEqual({ kind: 'failed', message: 'No such connection.' });
  });

  it('keeps the failure that came after rows as a failed state, so the page can keep the rows and not call a refresh an update', () => {
    const failure: PodsFailure = { kind: 'unreachable', message: 'Lost the cluster.' };
    const { state } = podsListSource(view({ state: { kind: 'loaded' }, failure, rows: [{ key: 'a' }] as unknown as PodsView['rows'] }));
    expect(state).toMatchObject({ kind: 'failed', message: 'Lost the cluster.' });
  });
});

describe('kindListSource: the words of a failure name the kind the page lists', () => {
  it('says the plural it is given, where the words name the kind and nowhere else', () => {
    const deployments = (state: PodsState) => kindListSource(view({ state }), 'Deployments', ALL_NAMESPACES).state;

    expect(deployments({ kind: 'denied' })).toMatchObject({ message: 'You do not have permission to list Deployments in all namespaces.' });
    expect(deployments({ kind: 'failed' })).toMatchObject({ message: 'Deployments could not be read.' });
    expect(deployments({ kind: 'unsupported' })).toEqual({ kind: 'failed', message: 'This cluster does not serve Deployments.' });
    expect(deployments({ kind: 'unreachable' })).toMatchObject({ message: 'The cluster did not answer.' });
  });
});

// A list the user may not read (the host answered FORBIDDEN, which is a 403). Asking again cannot change that, so the page offers no Retry (the contract draws a Retry only when the source gives one), and the
// words are the plugin's own: the runtime's text for a refusal is a fixed one ("The operation could not be completed.") that says nothing, and the page does not put what came over the wire on the screen.
describe('kindListSource: a list the user may not read', () => {
  const refused = (over: Partial<PodsView> = {}, plural = 'Pods', scope: NamespaceScope = ALL_NAMESPACES) =>
    kindListSource(view({ state: { kind: 'denied', message: 'The operation could not be completed.' }, ...over }), plural, scope).state;

  it('says that the user may not list the kind, in every namespace, and offers no Retry', () => {
    const state = refused();

    expect(state).toEqual({ kind: 'failed', message: 'You do not have permission to list Pods in all namespaces.' });
    expect(state).not.toHaveProperty('retry');
  });

  it('never shows the words the runtime gave: not a message of the connection\'s, not the host\'s fixed text, not what a server wrote', () => {
    for (const message of ['The operation could not be completed.', 'pods is forbidden: User "system:anonymous" cannot list resource "pods"', undefined]) {
      expect(refused({ state: { kind: 'denied', message } })).toEqual({ kind: 'failed', message: 'You do not have permission to list Pods in all namespaces.' });
    }
  });

  it('names the kind it is given, in the plural', () => {
    expect(refused({}, 'Roles')).toEqual({ kind: 'failed', message: 'You do not have permission to list Roles in all namespaces.' });
    expect(refused({}, 'NetworkPolicies')).toEqual({ kind: 'failed', message: 'You do not have permission to list NetworkPolicies in all namespaces.' });
  });

  it('says this cluster for a kind that lives in no namespace: there is no namespace to name', () => {
    expect(refused({ namespaced: false }, 'Nodes')).toEqual({ kind: 'failed', message: 'You do not have permission to list Nodes in this cluster.' });
    expect(refused({ namespaced: false }, 'ClusterRoles')).toEqual({ kind: 'failed', message: 'You do not have permission to list ClusterRoles in this cluster.' });
  });

  it('says this cluster when the catalog has not said whether the kind is namespaced: true of either', () => {
    expect(refused({ namespaced: undefined })).toEqual({ kind: 'failed', message: 'You do not have permission to list Pods in this cluster.' });
  });

  it('names the namespace of a namespaced kind that is read in one: the scope the list reads', () => {
    expect(refused({}, 'Pods', { kind: 'oneOf', namespaces: ['checkout'] })).toEqual({ kind: 'failed', message: 'You do not have permission to list Pods in the namespace checkout.' });
  });

  it('names two namespaces with "and", and more with commas and a last "and", sorted', () => {
    expect(refused({}, 'Pods', { kind: 'oneOf', namespaces: ['dev', 'checkout'] }).kind).toBe('failed');
    expect(refused({}, 'Pods', { kind: 'oneOf', namespaces: ['dev', 'checkout'] })).toMatchObject({ message: 'You do not have permission to list Pods in the namespaces checkout and dev.' });
    expect(refused({}, 'Pods', { kind: 'oneOf', namespaces: ['c', 'a', 'b'] })).toMatchObject({ message: 'You do not have permission to list Pods in the namespaces a, b and c.' });
  });

  it('says this cluster for a cluster-scoped kind whatever the scope: a scope of namespaces does not narrow it', () => {
    expect(refused({ namespaced: false }, 'Nodes', { kind: 'oneOf', namespaces: ['checkout'] })).toMatchObject({ message: 'You do not have permission to list Nodes in this cluster.' });
  });

  it('is the same when the refusal came after rows were shown: the failure kept beside them has no Retry and the same words', () => {
    const failure: PodsFailure = { kind: 'denied', message: 'The operation could not be completed.' };
    const state = podsListSource(view({ state: { kind: 'loaded' }, failure, rows: [{ key: 'a' }] as unknown as PodsView['rows'] })).state;

    expect(state).toEqual({ kind: 'failed', message: 'You do not have permission to list Pods in all namespaces.' });
    expect(state).not.toHaveProperty('retry');
  });

  it('does not take Retry from the other failures: a cluster that did not answer is still asked again', () => {
    const retry = vi.fn(async () => undefined);
    const state = podsListSource(view({ state: { kind: 'unreachable' }, retry })).state;

    expect(state).toHaveProperty('retry');
    expect(podsListSource(view({ state: { kind: 'failed' } })).state).toHaveProperty('retry');
    expect(podsListSource(view({ state: { kind: 'needs-sign-in' } })).state).toHaveProperty('retry');
  });
});

// The pages that read the connection without listing a kind (the cluster overview) say the same words for the states a connection can be in: they take them from here, so a list and the overview never say two things.
describe('connectionSentence: what a connection that is not ready says when the runtime gave no words', () => {
  it.each<['needs-sign-in' | 'unreachable' | 'not-found']>([['needs-sign-in'], ['unreachable'], ['not-found']])('is what the list says for %s', (kind) => {
    expect(podsListSource(view({ state: { kind } })).state).toMatchObject({ kind: 'failed', message: connectionSentence(kind) });
  });

  it('is the words of the connection, not of a kind: none of them names the Pods', () => {
    for (const kind of ['needs-sign-in', 'unreachable', 'not-found'] as const) {
      expect(connectionSentence(kind)).not.toMatch(/Pods/);
    }
  });
});
