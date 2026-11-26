import { vi } from 'vitest';

import type { ConnectionStateV1, ConnectionV1, ConnectionsHostV1, ConnectionsViewV1 } from '../contract/v1';

// Test support only: nothing in the data layer imports this file. The window's side of the seam as a test holds it: the plugin's connections in the host's own words, and the handle a page and the sidebar's hook are given
// (`context.connections`), whose every call is a recorded stand-in that answers `{ ok: true }` until a test says otherwise.

/** The host's word and role for each state: one word for each state (`ui-next/plugins/host/connections/words.ts`). */
export const WORDS: Readonly<Record<ConnectionStateV1, readonly [word: string, role: ConnectionV1['role']]>> = {
  connected: ['Connected', 'healthy'],
  connecting: ['Connecting…', 'progress'],
  disconnected: ['Disconnected', 'stopped'],
  unauthorized: ['Needs sign-in', 'attention'],
  forbidden: ['Access denied', 'error'],
  certificate: ['Certificate problem', 'error'],
  unreachable: ['Not responding', 'error'],
  failed: ['Connection failed', 'error'],
};

/** A connection as the host tells it (`ConnectionV1`): the host's word and role for its state, and the labels the plugin's backend put on it. */
export function connectionOf(key: string, state: ConnectionStateV1, over: Partial<ConnectionV1> = {}): ConnectionV1 {
  const [word, role] = WORDS[state];
  return { key, name: key, labels: {}, state, word, role, ...over };
}

export const viewOf = (...connections: readonly ConnectionV1[]): ConnectionsViewV1 => ({ loaded: true, failed: false, connections });

/** The handle of the plugin's connections, over a view that a test may change (`set`, which tells those that subscribed). Each call is a stand-in that records what it was asked. */
export function hostOf(first: ConnectionsViewV1) {
  let view = first;
  const listeners = new Set<() => void>();
  const open = vi.fn<ConnectionsHostV1['open']>(() => Promise.resolve({ ok: true }));
  const connect = vi.fn<ConnectionsHostV1['connect']>(() => Promise.resolve({ ok: true }));
  const check = vi.fn<ConnectionsHostV1['check']>(() => Promise.resolve({ ok: true }));
  const disconnect = vi.fn<ConnectionsHostV1['disconnect']>(() => Promise.resolve({ ok: true }));
  const remove = vi.fn<ConnectionsHostV1['remove']>(() => Promise.resolve({ ok: true }));
  const refresh = vi.fn<ConnectionsHostV1['refresh']>(() => Promise.resolve());
  const connections: ConnectionsHostV1 = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => view,
    open,
    connect,
    check,
    disconnect,
    remove,
    refresh,
  };
  const set = (next: ConnectionsViewV1) => {
    view = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };
  return { connections, open, connect, check, disconnect, remove, refresh, set };
}
