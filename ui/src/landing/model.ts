import type { StatusRole } from '@omniviewdev/kit';

import { connectionName } from '../connection';
import type { ConnectionBusyV1, ConnectionStateV1, ConnectionV1 } from '../contract/v1';

import { configFacts } from './facts';

// What the landing's pages draw, as plain data: the host's connections (its words and roles for where each stands, what it is doing to each, and the labels the facts come from), counted, narrowed and given the action
// each one is offered. The name that tells two connections of one name apart is the plugin's (`connectionName`), so that a page, the sidebar and the scope lane of the connection's pages say one name. Framework-free,
// so the rules are tests with no page.

/** One connection as a row of the table and a card: everything either draws, and the key (the plugin's id for it: what the host opens it by, never drawn). */
export type ConnectionRow = {
  readonly key: string;
  /** What a person reads: the name the plugin's other pages give the connection (`connectionName`). Never the key. */
  readonly name: string;
  /** The plugin's secondary text for it (`EKS · us-east-1 · 111122223333`). */
  readonly description: string | undefined;
  readonly state: ConnectionStateV1;
  /** The host's word for the state and the role of the kit's `Status` that draws it. */
  readonly word: string;
  readonly role: StatusRole;
  /** Why the last start failed, in a line the host made safe to show. */
  readonly reason: string | undefined;
  /** What the host is doing to the connection now: a start, or the verb that holds it. One thing at a time. */
  readonly busy: ConnectionBusyV1 | undefined;
  /** What the connection's configuration says of the cluster (`facts.ts`). */
  readonly platform: string | undefined;
  readonly region: string | undefined;
};

/** The rows for the host's connections, in the host's order (by name, then key). Each has the name the plugin's pages call it by and what its labels say of the cluster. */
export function rowsOf(connections: readonly ConnectionV1[]): readonly ConnectionRow[] {
  return connections.map((connection) => {
    const { platform, region } = configFacts(connection);
    return {
      key: connection.key,
      name: connectionName(connection, connections),
      description: connection.description,
      state: connection.state,
      word: connection.word,
      role: connection.role,
      reason: connection.reason,
      busy: connection.busy,
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

/** A connection needs attention when its start failed: it needs a sign-in, it is refused, its certificate is not trusted, it does not answer or it did not start. One that is stopped, or starting, is not a problem. */
export const needsAttention = (state: ConnectionStateV1): boolean => state === 'unauthorized' || state === 'forbidden' || state === 'certificate' || state === 'unreachable' || state === 'failed';

/** Whether a state is one a filter holds. No filter, which is All, holds every state. */
const inScope = (state: ConnectionStateV1, scope: Scope | null): boolean => scope === null || (scope === 'connected' ? state === 'connected' : needsAttention(state));

/** How many of the rows each filter holds. The counts are of every row, whatever is searched for: the strip says how the connections stand, and the footer says how many of them the search leaves. */
export function scopeCounts(rows: readonly Pick<ConnectionRow, 'state'>[]): Readonly<Record<Scope, number>> {
  return { connected: rows.filter((row) => row.state === 'connected').length, attention: rows.filter((row) => needsAttention(row.state)).length };
}

/** What narrows the rows besides the search: the state filter, and the values of the facets (a connection is left when its fact is one of the values of each facet that has any). No filter is All. */
export type Narrowing = {
  readonly scope: Scope | null;
  readonly platform: readonly string[];
  readonly region: readonly string[];
};

/** Whether a fact is one of a facet's values: a facet with no value narrows nothing. */
const among = (values: readonly string[], fact: string | undefined): boolean => values.length === 0 || (fact !== undefined && values.includes(fact));

/**
 * The rows a filter, the facets and a search leave, in the order they were given. A search is plain text, narrowed by every word of it, in any case, over what a row says of the connection: its name, the plugin's text for
 * it and, for one that failed, why. No filter is All.
 */
export function narrowed(rows: readonly ConnectionRow[], { scope, platform, region }: Narrowing, query: string): readonly ConnectionRow[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  return rows.filter((row) => {
    const said = [row.name, row.description, row.reason].join('\n').toLowerCase();
    return inScope(row.state, scope) && among(platform, row.platform) && among(region, row.region) && words.every((word) => said.includes(word));
  });
}

/** What a row's main button says and does: it is for the state the host says the connection is in. */
export type Primary = {
  readonly label: 'Open' | 'Sign in' | 'Retry';
  /** The one filled button of the list: the connection is waiting for the person to sign in. */
  readonly prominent: boolean;
  /** The host is doing something to the connection, so what the button asks of it would be refused: it is drawn busy and does nothing until the host is done. */
  readonly busy: boolean;
};

/**
 * The action a connection is offered first, from the state the host says it is in. Pressing it is always the same thing, `context.connections.open`, which the host answers by starting the connection first when it
 * is not connected (the host never leaves a page to start one) and opening it once it is: so a connection that can be used, or that has not been started, is opened; one that needs a sign-in is offered the sign-in,
 * which is the start again (the credentials are asked for again by the start); and one that was refused, whose certificate is not trusted, that did not answer or that did not start is offered a retry, which is the
 * start again as well, pressed by the person and never by the page: nothing here asks again by itself. While the host is doing something to the connection (a start of its own, a check, a disconnect, a removal) the
 * button is busy.
 */
export function primaryOf({ state, busy }: Pick<ConnectionRow, 'state' | 'busy'>): Primary {
  const working = busy !== undefined || state === 'connecting';
  switch (state) {
    case 'connected':
    case 'connecting':
    case 'disconnected':
      return { label: 'Open', prominent: false, busy: working };
    case 'unauthorized':
      return { label: 'Sign in', prominent: true, busy: working };
    case 'forbidden':
    case 'certificate':
    case 'unreachable':
    case 'failed':
      return { label: 'Retry', prominent: false, busy: working };
  }
}

/** What the host is doing to a connection, in the place of the state's word (the host's own sentences name them: connecting, being checked, disconnecting, being removed). */
export const BUSY_WORDS: Readonly<Record<ConnectionBusyV1, string>> = { connecting: 'Connecting…', checking: 'Checking…', disconnecting: 'Disconnecting…', removing: 'Removing…' };

/** What a row says of where the connection stands: the host's word for its state, or what the host is doing to it, with the role that draws the glyph. */
export function standingOf({ word, role, busy }: Pick<ConnectionRow, 'word' | 'role' | 'busy'>): { readonly word: string; readonly role: StatusRole } {
  return busy === undefined ? { word, role } : { word: BUSY_WORDS[busy], role: 'progress' };
}

/** What is under way, as the reason a verb is refused: the host refuses a second verb on a connection, and its own stop waits behind a start that does not end. */
const UNDER_WAY: Readonly<Record<ConnectionBusyV1, string>> = {
  connecting: 'A start is under way.',
  checking: 'A check is under way.',
  disconnecting: 'A disconnect is under way.',
  removing: 'A removal is under way.',
};

/** What the menu of a connection allows: for each verb, why it is not (the reason the menu says in its tip), or undefined when it is. */
export type Allowed = {
  readonly open: string | undefined;
  readonly connect: string | undefined;
  readonly check: string | undefined;
  readonly disconnect: string | undefined;
  readonly remove: string | undefined;
};

/**
 * The verbs a connection may be given now, by the mock's rules (`connectionMenuItems`): none while the host is doing something to it, which it would refuse in a sentence of its own (`ConnectionsHostV1`: one verb at
 * a time, and a connection that is connecting is not checked, disconnected or removed); Connect only when it is not connected; Check and Disconnect only when it is.
 */
export function allowedOf({ state, busy }: Pick<ConnectionRow, 'state' | 'busy'>): Allowed {
  const working = busy ?? (state === 'connecting' ? 'connecting' : undefined);
  const refused = working === undefined ? undefined : `${UNDER_WAY[working]} Try again when it has finished.`;
  const connected = state === 'connected';
  return {
    open: refused,
    connect: refused ?? (connected ? 'Already connected.' : undefined),
    check: refused ?? (connected ? undefined : 'Connect first to check it.'),
    disconnect: refused ?? (connected ? undefined : state === 'disconnected' ? 'Already disconnected.' : 'Not connected.'),
    remove: refused,
  };
}

/** The border of a card tells a connection in trouble from one that is not, and its word beside it says the same: a tone is never the only cue. */
export const toneOf = (role: StatusRole): 'warning' | 'error' | undefined => (role === 'error' ? 'error' : role === 'attention' ? 'warning' : undefined);
