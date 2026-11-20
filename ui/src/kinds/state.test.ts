import type { HostSourceStatus } from '@omniviewdev/runtime/ui/v1';
import { describe, expect, it } from 'vitest';

import { readKindState, type KindReads } from './state';

// What the runtime hooks return for each state of a connection, captured on 2026-11-16 from the real host (server mode, the Kubernetes
// plugin 0.21.2, kind v1.35) through a kubeconfig with four contexts: a good one, a bogus token, a service account with no rights, and
// a server nobody listens on. docs/ui-next/status/1a.2.md has the capture and how to repeat it.

const NOTHING = { error: null } as const;

/** Connected, with every step answered and nothing read yet; each test changes what it is about. */
const connected: KindReads = {
  phase: 'connected',
  message: undefined,
  catalog: { loaded: true, offersType: true, error: null },
  target: NOTHING,
  read: { error: null, source: undefined },
  rows: 0,
  complete: false,
};
const reads = (change: Partial<KindReads>): KindReads => ({ ...connected, ...change });

// An error as the Wails transport and the host deliver it: the host's complete error envelope.
const envelope = (status: number, type: string, code?: string) => ({ type, title: 'x', status, detail: 'The operation could not be completed.', ...(code ? { code } : {}) });
const FORBIDDEN = envelope(403, 'omniview:resource/forbidden', 'FORBIDDEN');
const UNAUTHORIZED = envelope(401, 'omniview:resource/unauthorized', 'UNAUTHORIZED');
const UNAVAILABLE = envelope(503, 'omniview:connection/failed', 'UNAVAILABLE');
const BROKEN = envelope(500, 'omniview:internal', 'INTERNAL');

describe('the connection, before anything is read (useConnectionReadiness)', () => {
  const state = (phase: KindReads['phase'], message?: string) => readKindState(reads({ phase, message })).state;

  it('is connecting while the runtime checks or starts the connection', () => {
    expect(state('checking')).toEqual({ kind: 'connecting' });
    expect(state('connecting')).toEqual({ kind: 'connecting' });
  });

  it('is disconnected when the runtime found it stopped: it never connects by itself, the caller decides (D4)', () => {
    expect(state('disconnected')).toEqual({ kind: 'disconnected' });
  });

  it('needs sign-in when the provider wants credentials (captured: a bogus token)', () => {
    expect(state('unauthorized', 'The provider requires authentication.')).toEqual({ kind: 'needs-sign-in', message: 'The provider requires authentication.' });
  });

  it('is denied when the connection check is forbidden', () => {
    expect(state('forbidden', 'Forbidden.')).toEqual({ kind: 'denied', message: 'Forbidden.' });
  });

  it('is unreachable when the check failed (captured: a server nobody listens on)', () => {
    expect(state('error', 'resource operation failed')).toEqual({ kind: 'unreachable', message: 'resource operation failed' });
  });

  it('says the connection is gone when the runtime does not know it (captured: an id the plugin lists no more)', () => {
    expect(state('not-found', 'resource operation failed')).toEqual({ kind: 'not-found', message: 'resource operation failed' });
  });

  it('reads nothing else until the connection is ready: a stale error or a row count of an earlier connection does not speak', () => {
    const result = readKindState(reads({ phase: 'disconnected', catalog: { loaded: true, offersType: false, error: FORBIDDEN }, rows: 12, complete: true }));

    expect(result).toEqual({ state: { kind: 'disconnected' }, failure: undefined });
  });
});

describe('connected: the catalog and the target', () => {
  it('is loading while the catalog, the target or the first rows are on their way', () => {
    expect(readKindState(reads({ catalog: { loaded: false, offersType: false, error: null } })).state).toEqual({ kind: 'loading' });
    expect(readKindState(connected).state).toEqual({ kind: 'loading' });
  });

  it('is unsupported when the catalog does not list the Pod type', () => {
    expect(readKindState(reads({ catalog: { loaded: true, offersType: false, error: null } })).state).toEqual({ kind: 'unsupported' });
  });

  it('files an error of the catalog or the target by what it says', () => {
    expect(readKindState(reads({ catalog: { loaded: false, offersType: false, error: FORBIDDEN } })).state).toMatchObject({ kind: 'denied' });
    expect(readKindState(reads({ catalog: { loaded: false, offersType: false, error: UNAUTHORIZED } })).state).toMatchObject({ kind: 'needs-sign-in' });
    expect(readKindState(reads({ target: { error: UNAVAILABLE } })).state).toMatchObject({ kind: 'unreachable' });
    expect(readKindState(reads({ target: { error: BROKEN } })).state).toMatchObject({ kind: 'failed' });
  });
});

describe('connected: the rows', () => {
  // Captured: the service account with no rights connects, lists the catalog and resolves the target, then the source fails.
  const forbiddenSource: HostSourceStatus = { state: 'failed', mode: 'snapshotAndUpdates', count: { kind: 'exact', value: '0' }, error: { code: 'FORBIDDEN', title: '', message: 'Source session failed.' } };
  const forbiddenRead = { code: 'FORBIDDEN', title: '', message: 'Source session failed.' };

  it('is denied when the source of a connected, allowed connection fails with FORBIDDEN (captured)', () => {
    const result = readKindState(reads({ read: { error: forbiddenRead, source: forbiddenSource } }));

    expect(result.state).toMatchObject({ kind: 'denied' });
    expect(result.failure).toBeUndefined();
  });

  it('reads the failure from the source when the query itself holds no error (a source that fails after the first snapshot)', () => {
    const result = readKindState(reads({ read: { error: null, source: forbiddenSource }, rows: 40, complete: true }));

    expect(result.state).toEqual({ kind: 'loaded' });
    expect(result.failure).toMatchObject({ kind: 'denied' });
  });

  it('files an RPC error of the read by its status', () => {
    expect(readKindState(reads({ read: { error: UNAUTHORIZED, source: undefined } })).state).toMatchObject({ kind: 'needs-sign-in' });
    expect(readKindState(reads({ read: { error: UNAVAILABLE, source: undefined } })).state).toMatchObject({ kind: 'unreachable' });
    expect(readKindState(reads({ read: { error: BROKEN, source: undefined } })).state).toMatchObject({ kind: 'failed' });
    expect(readKindState(reads({ read: { error: new Error('boom'), source: undefined } })).state).toMatchObject({ kind: 'failed' });
  });

  // A refusal is the host's FORBIDDEN, which its envelope maps to a 403 (`parseAppError`); either says it, so a read whose envelope carries one and not the other is still a list the user may not read.
  it('files a refusal by its code or by its status: FORBIDDEN is denied whatever status the envelope carries, and so is a 403 whatever its code', () => {
    const byCode = envelope(500, 'omniview:internal', 'FORBIDDEN');
    const byStatus = envelope(403, 'omniview:resource/forbidden', 'INTERNAL');

    expect(readKindState(reads({ read: { error: byCode, source: undefined } })).state).toMatchObject({ kind: 'denied' });
    expect(readKindState(reads({ read: { error: byStatus, source: undefined } })).state).toMatchObject({ kind: 'denied' });
    expect(readKindState(reads({ read: { error: envelope(500, 'omniview:internal', 'INTERNAL'), source: undefined } })).state).toMatchObject({ kind: 'failed' });
  });

  it('ignores a cancelled read: the runtime cancels on every change of the connection, and that is not a failure', () => {
    expect(readKindState(reads({ read: { error: 'cancelled', source: undefined } })).state).toEqual({ kind: 'loading' });
    expect(readKindState(reads({ read: { error: { name: 'AbortError' }, source: undefined } })).state).toEqual({ kind: 'loading' });
  });

  it('still reports a failed source when the query error is a cancelled read', () => {
    const result = readKindState(reads({ read: { error: 'cancelled', source: forbiddenSource } }));

    expect(result.state).toMatchObject({ kind: 'denied' });
  });

  it('is loaded as soon as there are rows, complete or not', () => {
    expect(readKindState(reads({ rows: 256 }))).toEqual({ state: { kind: 'loaded' }, failure: undefined });
    expect(readKindState(reads({ rows: 5025, complete: true }))).toEqual({ state: { kind: 'loaded' }, failure: undefined });
  });

  it('is empty only when the complete set is empty', () => {
    expect(readKindState(reads({ rows: 0, complete: true })).state).toEqual({ kind: 'empty' });
    expect(readKindState(reads({ rows: 0, complete: false })).state).toEqual({ kind: 'loading' });
  });

  it('keeps the rows and reports the failure beside them, rather than replacing the list', () => {
    const result = readKindState(reads({ rows: 256, read: { error: UNAVAILABLE, source: undefined } }));

    expect(result.state).toEqual({ kind: 'loaded' });
    expect(result.failure).toMatchObject({ kind: 'unreachable' });
  });
});
