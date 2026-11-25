import type { ConnectionReadinessPhase } from '@omniviewdev/runtime/ui/v1';
import { describe, expect, it, vi } from 'vitest';

import type { PodRow } from '../kinds/pods/row';
import { kindListSource } from '../kinds/source';
import { connectionState } from '../kinds/state';
import type { KindView } from '../kinds/useKindRows';
import { ALL_NAMESPACES } from '../sidebar/scope';

import { pageState } from './state';

// The overview reads a connection, not a kind: while the connection is not ready its state is the page's, and the page says what the Pods list says for the same state (`kinds/state.ts`, `kinds/source.ts`), as a
// page of one object does, in the detail page's words: loading while the connection starts, failed with the cause and a Retry, denied.

const retry = vi.fn();

describe('pageState: the state of the page while its connection is not ready', () => {
  it('is nothing for a connection that is ready: what the page reads decides what it says', () => {
    expect(pageState('connected', undefined, retry)).toBeUndefined();
  });

  it.each<ConnectionReadinessPhase>(['checking', 'connecting', 'disconnected'])('is loading while the phase is %s: the page starts a connection it finds stopped, so there is nothing to wait on but the answer', (phase) => {
    expect(pageState(phase, undefined, retry)).toEqual({ kind: 'loading' });
  });

  it('is failed with the runtime\'s own words, when it gave some, and a Retry, for a connection that needs sign-in or did not answer', () => {
    expect(pageState('unauthorized', 'The provider requires authentication.', retry)).toEqual({ kind: 'failed', message: 'The provider requires authentication.', retry });
    expect(pageState('error', 'dial tcp: i/o timeout', retry)).toEqual({ kind: 'failed', message: 'dial tcp: i/o timeout', retry });
  });

  it('is failed with the plugin\'s own sentence when the runtime gave none', () => {
    expect(pageState('unauthorized', undefined, retry)).toEqual({ kind: 'failed', message: 'The connection needs you to sign in.', retry });
    expect(pageState('error', undefined, retry)).toEqual({ kind: 'failed', message: 'The cluster did not answer.', retry });
  });

  it('is failed with nothing to retry for a connection that is gone: asking again cannot bring it back', () => {
    const state = pageState('not-found', undefined, retry);

    expect(state).toEqual({ kind: 'failed', message: 'This connection no longer exists.' });
    expect(state).not.toHaveProperty('retry');
  });

  it('is denied for a connection the user may not use, in the host\'s words and with no Retry: a refusal is the same however often it is asked', () => {
    const state = pageState('forbidden', 'Forbidden.', retry);

    expect(state).toEqual({ kind: 'denied' });
  });
});

// The same state, said by the Pods list: the page says what the list says, in the words of the connection and not of the kind.
describe('pageState: says what the Pods list says for each state of the connection', () => {
  const podsView = (phase: ConnectionReadinessPhase, message: string | undefined): KindView<PodRow> => ({
    state: connectionState(phase, message) ?? { kind: 'loading' },
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
  });

  it.each<[ConnectionReadinessPhase, string | undefined]>([
    ['checking', undefined],
    ['connecting', undefined],
    ['disconnected', undefined],
    ['unauthorized', undefined],
    ['unauthorized', 'The provider requires authentication.'],
    ['error', undefined],
    ['error', 'resource operation failed'],
    ['not-found', undefined],
    ['not-found', 'No such connection.'],
  ])('is what it says for the phase %s with the words %j', (phase, message) => {
    const list = kindListSource(podsView(phase, message), 'Pods', ALL_NAMESPACES).state;
    const page = pageState(phase, message, retry);

    expect(page).toMatchObject({ kind: list.kind });
    if (list.kind === 'failed') {
      expect(page).toMatchObject({ message: list.message });
      expect(page !== undefined && 'retry' in page && page.retry !== undefined).toBe(list.retry !== undefined);
    }
  });
});
