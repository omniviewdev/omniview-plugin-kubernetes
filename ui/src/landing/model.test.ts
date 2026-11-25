import { describe, expect, it } from 'vitest';

import type { ConnectionStateV1 } from '../contract/v1';

import { narrowed, primaryOf, scopeCounts, summaryOf, type ConnectionRow } from './model';

// What the landing's pages say of the connections, as data: how they stand, which action each is offered, and what a filter and a search leave. The pages draw these answers (`pages.test.tsx`).

const WORDS: Readonly<Record<ConnectionStateV1, string>> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Disconnected',
  unauthorized: 'Needs sign-in',
  forbidden: 'Access denied',
  unreachable: 'Not responding',
  failed: 'Connection failed',
};

const row = (key: string, state: ConnectionStateV1, over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  key,
  name: key,
  description: undefined,
  state,
  word: WORDS[state],
  role: 'stopped',
  reason: undefined,
  platform: undefined,
  region: undefined,
  ...over,
});

describe('the facts line of the home page', () => {
  it('says how many connections there are and how they stand, and leaves out every part that is zero but the count: a start under way, a stopped connection and a failure other than a sign-in are all not connected', () => {
    const all = ['connected', 'connected', 'unauthorized', 'connecting', 'disconnected', 'failed'].map((state, index) => row(`c${String(index)}`, state as ConnectionStateV1));

    expect(summaryOf(all)).toEqual(['6 connections', '2 connected', '1 needs sign-in', '3 not connected']);
    expect(summaryOf([...all, row('d', 'unauthorized')]).slice(2, 3)).toEqual(['2 need sign-in']);
    expect(summaryOf([row('a', 'connected'), row('b', 'connected')])).toEqual(['2 connections', '2 connected']);
    expect(summaryOf([row('a', 'disconnected')])).toEqual(['1 connection', '1 not connected']);
    expect(summaryOf([])).toEqual(['0 connections']);
  });
});

describe('the action a connection is offered first', () => {
  it('is Open for one that can be used and for one that has not been started, the sign-in (the one filled button) for one that needs it, and a retry for one that was refused, does not answer or did not start; a start under way is Open, busy', () => {
    const offered = (Object.keys(WORDS) as ConnectionStateV1[]).map((state) => [state, primaryOf(state)] as const);

    expect(offered).toEqual([
      ['connected', { label: 'Open', prominent: false, busy: false }],
      ['connecting', { label: 'Open', prominent: false, busy: true }],
      ['disconnected', { label: 'Open', prominent: false, busy: false }],
      ['unauthorized', { label: 'Sign in', prominent: true, busy: false }],
      ['forbidden', { label: 'Retry', prominent: false, busy: false }],
      ['unreachable', { label: 'Retry', prominent: false, busy: false }],
      ['failed', { label: 'Retry', prominent: false, busy: false }],
    ]);
  });
});

describe('the connections a filter and a search leave', () => {
  const rows = [
    row('north', 'connected', { name: 'north', description: 'EKS · us-east-1 · 111122223333' }),
    row('south', 'unauthorized', { name: 'south', reason: 'The connection needs you to sign in.' }),
    row('east', 'unreachable', { name: 'East Coast', description: 'EKS · us-east-2 · 111122223333', reason: 'The server did not answer.' }),
    row('west', 'disconnected', { name: 'west' }),
    row('lab', 'connecting', { name: 'lab' }),
  ];

  it('counts Connected and Needs attention among all of them, whatever is searched for (a connection that is stopped or starting needs no attention), and keeps what a filter and a plain search leave in order: every word of the search, in any case, over the name, the plugin\'s text and why a start failed', () => {
    expect(scopeCounts(rows)).toEqual({ connected: 1, attention: 2 });
    expect(narrowed(rows, null, '').map((kept) => kept.key)).toEqual(['north', 'south', 'east', 'west', 'lab']);
    expect(narrowed(rows, 'connected', '').map((kept) => kept.key)).toEqual(['north']);
    expect(narrowed(rows, 'attention', '').map((kept) => kept.key)).toEqual(['south', 'east']);
    expect(narrowed(rows, null, 'EAST coast').map((kept) => kept.key)).toEqual(['east']);
    expect(narrowed(rows, null, 'eks 111122223333').map((kept) => kept.key)).toEqual(['north', 'east']);
    expect(narrowed(rows, null, 'did not answer').map((kept) => kept.key)).toEqual(['east']);
    expect(narrowed(rows, 'attention', 'eks').map((kept) => kept.key)).toEqual(['east']);
    expect(narrowed(rows, 'connected', 'south')).toEqual([]);
  });
});
