import type { StatusRole } from '@omniviewdev/kit';
import type { Connection } from '@omniviewdev/runtime/ui/v1';

import { connectionName } from '../connection';
import type { ConnectionStateV1, ConnectionV1 } from '../contract/v1';

import { configFacts } from './facts';

// What the landing's pages draw, as plain data: the host's connections (its words and roles for where each stands) joined with what the plugin's own list of them says (the name that tells two of one name
// apart, and the labels the facts come from), then counted, narrowed and given the action each one is offered. Framework-free, so the rules are tests with no page.

/** One connection as a row of the table and a card: everything either draws, and the key (the plugin's id for it: what the host opens it by, never drawn). */
export type ConnectionRow = {
  readonly key: string;
  /** What a person reads: the name the plugin's other pages give the connection (`connectionName`), else the host's. Never the key. */
  readonly name: string;
  /** The plugin's secondary text for it (`EKS · us-east-1 · 111122223333`). */
  readonly description: string | undefined;
  readonly state: ConnectionStateV1;
  /** The host's word for the state and the role of the kit's `Status` that draws it. */
  readonly word: string;
  readonly role: StatusRole;
  /** Why the last start failed, in a line the host made safe to show. */
  readonly reason: string | undefined;
  /** What the connection's configuration says of the cluster (`facts.ts`). */
  readonly platform: string | undefined;
  readonly region: string | undefined;
};

/**
 * The rows for the host's connections. `known` is the plugin's own list of them (`useConnections`), which has what the host's does not carry: the labels, and the names the plugin's other pages call a connection
 * by. Until it has answered, or for a connection it does not list, the row has the host's name and no configured facts.
 */
export function rowsOf(connections: readonly ConnectionV1[], known: readonly Connection[] | undefined): readonly ConnectionRow[] {
  const list = known ?? [];
  const byKey = new Map(list.map((connection) => [connection.id, connection]));
  return connections.map((connection) => {
    const own = byKey.get(connection.key);
    const { platform, region } = own === undefined ? { platform: undefined, region: undefined } : configFacts(own);
    return {
      key: connection.key,
      name: own === undefined ? connection.name : connectionName(own, list),
      description: connection.description,
      state: connection.state,
      word: connection.word,
      role: connection.role,
      reason: connection.reason,
      platform,
      region,
    };
  });
}

/** The line under a connection's name: why its last start failed, when it did, else what the plugin says of it. */
export const lineOf = (row: Pick<ConnectionRow, 'reason' | 'description'>): string | undefined => row.reason ?? row.description;

const grouped = (count: number): string => count.toLocaleString('en-US');

/**
 * The facts of the home page's header, as the mock says them (`summaryFacts`): how many connections there are and, of them, how many are connected, how many need a sign-in and how many are not connected
 * (a start under way, a connection stopped or one that failed in another way). A part that is zero is left out, except the first.
 */
export function summaryOf(rows: readonly Pick<ConnectionRow, 'state'>[]): readonly string[] {
  const connected = rows.filter((row) => row.state === 'connected').length;
  const signIn = rows.filter((row) => row.state === 'unauthorized').length;
  const other = rows.length - connected - signIn;
  return [
    `${grouped(rows.length)} ${rows.length === 1 ? 'connection' : 'connections'}`,
    ...(connected > 0 ? [`${grouped(connected)} connected`] : []),
    ...(signIn > 0 ? [`${grouped(signIn)} ${signIn === 1 ? 'needs' : 'need'} sign-in`] : []),
    ...(other > 0 ? [`${grouped(other)} not connected`] : []),
  ];
}

/** The two states of the strip of quick filters, after All. */
export type Scope = 'connected' | 'attention';

/** A connection needs attention when its start failed: it needs a sign-in, it is refused, it does not answer or it did not start. One that is stopped, or starting, is not a problem. */
const needsAttention = (state: ConnectionStateV1): boolean => state === 'unauthorized' || state === 'forbidden' || state === 'unreachable' || state === 'failed';

/** Whether a state is one a filter holds. No filter, which is All, holds every state. */
const inScope = (state: ConnectionStateV1, scope: Scope | null): boolean => scope === null || (scope === 'connected' ? state === 'connected' : needsAttention(state));

/** How many of the rows each filter holds. The counts are of every row, whatever is searched for: the strip says how the connections stand, and the footer says how many of them the search leaves. */
export function scopeCounts(rows: readonly Pick<ConnectionRow, 'state'>[]): Readonly<Record<Scope, number>> {
  return { connected: rows.filter((row) => row.state === 'connected').length, attention: rows.filter((row) => needsAttention(row.state)).length };
}

/**
 * The rows a filter and a search leave, in the order they were given. A search is plain text, narrowed by every word of it, in any case, over what a row says of the connection: its name, the plugin's text for
 * it and, for one that failed, why. No filter is All.
 */
export function narrowed(rows: readonly ConnectionRow[], scope: Scope | null, query: string): readonly ConnectionRow[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  return rows.filter((row) => {
    const said = [row.name, row.description, row.reason].join('\n').toLowerCase();
    return inScope(row.state, scope) && words.every((word) => said.includes(word));
  });
}

/** What a row's main button says and does: it is for the state the host says the connection is in. */
export type Primary = {
  readonly label: 'Open' | 'Sign in' | 'Retry';
  /** The one filled button of the list: the connection is waiting for the person to sign in. */
  readonly prominent: boolean;
  /** The connection is starting: the button that started it is still working. */
  readonly busy: boolean;
};

/**
 * The action a connection is offered first, from the state the host says it is in. Pressing it is always the same thing, `context.connections.open`, which the host answers by starting the connection first when it
 * is not connected (the host never leaves a page to start one) and opening it once it is: so a connection that can be used, or that has not been started, is opened; one that needs a sign-in is offered the sign-in,
 * which is the start again (the credentials are asked for again by the start); and one that was refused, that did not answer or that did not start is offered a retry, which is the start again as well.
 */
export function primaryOf(state: ConnectionStateV1): Primary {
  switch (state) {
    case 'connected':
    case 'disconnected':
      return { label: 'Open', prominent: false, busy: false };
    case 'connecting':
      return { label: 'Open', prominent: false, busy: true };
    case 'unauthorized':
      return { label: 'Sign in', prominent: true, busy: false };
    case 'forbidden':
    case 'unreachable':
    case 'failed':
      return { label: 'Retry', prominent: false, busy: false };
  }
}

/** The border of a card tells a connection in trouble from one that is not, and its word beside it says the same: a tone is never the only cue. */
export const toneOf = (role: StatusRole): 'warning' | 'error' | undefined => (role === 'error' ? 'error' : role === 'attention' ? 'warning' : undefined);
