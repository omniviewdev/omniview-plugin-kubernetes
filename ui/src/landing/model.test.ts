import { describe, expect, it } from 'vitest';

import type { ConnectionStateV1 } from '../contract/v1';

import { allowedOf, narrowed, primaryOf, scopeCounts, standingOf, summaryOf, type ConnectionRow, type Narrowing } from './model';
import { WORDS } from './testing';

// What the landing's pages say of the connections, as data: how they stand, which action each is offered, what the menu allows, and what a filter, the facets and a search leave. The pages draw these answers
// (`pages.test.tsx`).

const row = (key: string, state: ConnectionStateV1, over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  key,
  name: key,
  description: undefined,
  state,
  word: WORDS[state][0],
  role: WORDS[state][1],
  reason: undefined,
  busy: undefined,
  platform: undefined,
  region: undefined,
  ...over,
});

const STATES = Object.keys(WORDS) as ConnectionStateV1[];

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
  it('is Open for one that can be used and for one that has not been started, the sign-in (the one filled button) for one that needs it, and a retry for one that was refused, whose certificate is not trusted, does not answer or did not start; the button is busy while the host is doing something to the connection', () => {
    const offered = STATES.map((state) => [state, primaryOf({ state, busy: undefined })] as const);

    expect(offered).toEqual([
      ['connected', { label: 'Open', prominent: false, busy: false }],
      ['connecting', { label: 'Open', prominent: false, busy: true }],
      ['disconnected', { label: 'Open', prominent: false, busy: false }],
      ['unauthorized', { label: 'Sign in', prominent: true, busy: false }],
      ['forbidden', { label: 'Retry', prominent: false, busy: false }],
      ['certificate', { label: 'Retry', prominent: false, busy: false }],
      ['unreachable', { label: 'Retry', prominent: false, busy: false }],
      ['failed', { label: 'Retry', prominent: false, busy: false }],
    ]);
    expect(primaryOf({ state: 'connected', busy: 'checking' })).toEqual({ label: 'Open', prominent: false, busy: true });
    expect(primaryOf({ state: 'certificate', busy: 'connecting' })).toEqual({ label: 'Retry', prominent: false, busy: true });
  });
});

describe('what the menu of a connection allows', () => {
  it('offers Connect only to one that is not connected, Check and Disconnect only to one that is, and nothing but the name\'s copy while the host is doing something to it, which it would refuse in a sentence; each verb that is not offered says why', () => {
    const allowed = (state: ConnectionStateV1, busy?: ConnectionRow['busy']) => allowedOf({ state, busy });

    expect(allowed('connected')).toEqual({ open: undefined, connect: 'Already connected.', check: undefined, disconnect: undefined, remove: undefined });
    expect(allowed('disconnected')).toEqual({ open: undefined, connect: undefined, check: 'Connect first to check it.', disconnect: 'Already disconnected.', remove: undefined });
    expect(allowed('certificate')).toMatchObject({ open: undefined, connect: undefined, disconnect: 'Not connected.' });

    // The host's own stop waits behind a start that does not end, so a connection that is connecting is not checked, disconnected or removed, and one that a verb holds takes no second verb.
    for (const refused of [allowed('connecting'), allowed('connected', 'checking'), allowed('disconnected', 'removing')]) {
      expect(Object.values(refused).every((reason) => reason?.endsWith('Try again when it has finished.'))).toBe(true);
    }
    expect(allowed('connected', 'disconnecting').remove).toBe('A disconnect is under way. Try again when it has finished.');

    // What a row says of where the connection stands: the host's word, until the host is doing something to it.
    expect(standingOf(row('a', 'connected'))).toEqual({ word: 'Connected', role: 'healthy' });
    expect(standingOf(row('a', 'connected', { busy: 'checking' }))).toEqual({ word: 'Checking…', role: 'progress' });
    expect(standingOf(row('a', 'certificate'))).toEqual({ word: 'Certificate problem', role: 'error' });
  });
});

describe('the connections a filter, the facets and a search leave', () => {
  const rows = [
    row('north', 'connected', { name: 'north', description: 'EKS · us-east-1 · 111122223333', platform: 'EKS', region: 'us-east-1' }),
    row('south', 'unauthorized', { name: 'south', reason: 'The connection needs you to sign in.', platform: 'EKS', region: 'us-east-2' }),
    row('east', 'unreachable', { name: 'East Coast', description: 'EKS · us-east-2 · 111122223333', reason: 'The server did not answer.', platform: 'GKE' }),
    row('west', 'disconnected', { name: 'west', platform: 'kind' }),
    row('lab', 'connecting', { name: 'lab' }),
  ];
  const all: Narrowing = { scope: null, platform: [], region: [] };
  const keys = (narrowing: Narrowing, query = '') => narrowed(rows, narrowing, query).map((kept) => kept.key);

  it('counts Connected and Needs attention among all of them, whatever is searched for (a connection that is stopped or starting needs no attention), and keeps what a filter, a value of a facet and a plain search leave in order: every word of the search, in any case, over the name, the plugin\'s text and why a start failed', () => {
    expect(scopeCounts(rows)).toEqual({ connected: 1, attention: 2 });
    expect(keys(all)).toEqual(['north', 'south', 'east', 'west', 'lab']);
    expect(keys({ ...all, scope: 'connected' })).toEqual(['north']);
    expect(keys({ ...all, scope: 'attention' })).toEqual(['south', 'east']);
    expect(keys(all, 'EAST coast')).toEqual(['east']);
    expect(keys(all, 'eks 111122223333')).toEqual(['north', 'east']);
    expect(keys(all, 'did not answer')).toEqual(['east']);
    expect(keys({ ...all, scope: 'attention' }, 'eks')).toEqual(['east']);
    expect(keys({ ...all, scope: 'connected' }, 'south')).toEqual([]);

    // A facet with values leaves the connections whose fact is one of them, and the ones that state none are in no value; two facets narrow together, and with the filter and the search.
    expect(keys({ ...all, platform: ['EKS'] })).toEqual(['north', 'south']);
    expect(keys({ ...all, platform: ['GKE', 'kind'] })).toEqual(['east', 'west']);
    expect(keys({ ...all, platform: ['EKS'], region: ['us-east-2'] })).toEqual(['south']);
    expect(keys({ ...all, scope: 'attention', platform: ['EKS'] })).toEqual(['south']);
    expect(keys({ ...all, region: ['us-east-1', 'us-east-2'] }, 'sign in')).toEqual(['south']);
  });
});
