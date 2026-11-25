import { useConnections, type Connection } from '@omniviewdev/runtime/ui/v1';

import type { ShellScopeFace } from './contract/v1';

// The connection a page of this plugin reads, and how its scope lane names it. Every page of the plugin shares this one answer, so the Pods list and the page of one Pod
// read the same connection for the same route and say the same thing in the lane.
//
// A connection has two things that look alike and are not. Its ID (`<slug>-<10 hex>`, e.g. `kind-dev-54c660ecd1`) is a key and a route: pages read by it, a tab is found by it, a Logs
// target is told apart by it. Its NAME is what a person reads: the plugin states it (the name of the context it was made from, or the cluster's name for an EKS context, whose context
// name is an unreadable ARN), or the user renamed it. Its DESCRIPTION is the secondary text the plugin gives it (`EKS · us-east-1 · 111122223333`). The frame prints names and never ids.

export type PageConnection = {
  /** The connection the page reads. Absent while the plugin's connections are on their way, and when the plugin has none. Its `id` is the key the page reads by; never print it. */
  readonly chosen: Connection | undefined;
  /** The plugin's connections are on their way. */
  readonly pending: boolean;
  /**
   * The name the frame gives the connection (the scope lane, the status bar's path, the scope of a Logs session): the name of the one the page reads, with a second word when another
   * connection has the same name (see `connectionName`). It is never the connection's id and never the route, which holds an id. Undefined while the connections are on their way, and when the plugin has none.
   */
  readonly named: string | undefined;
};

/** What a connection is called when it has no name and no context to take one from. */
const UNNAMED = 'Unnamed';

/** The separator between a connection's name and the word that tells it from another connection of the same name: a space, a middle dot, a space. */
const WHERE_SEPARATOR = ' \u00B7 ';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The name a person reads for one connection, alone: its name; when that is blank, the context it was made from; when there is none either, a fixed word. Never the id. */
function ownName(connection: Connection): string {
  const context = (connection.data as { readonly context?: unknown } | undefined)?.context;
  return text(connection.name) || text(context) || UNNAMED;
}

/** The segments of the path of the kubeconfig a connection came from (split on `/` and `\`, empty ones dropped); none when the connection carries no usable one. */
function kubeconfigSegments(connection: Connection): readonly string[] {
  const path = (connection.labels as { readonly kubeconfig?: unknown } | undefined)?.kubeconfig;
  return typeof path === 'string' ? path.split(/[\\/]/).filter((segment) => segment !== '') : [];
}

/**
 * The name the frame gives a connection among the plugin's. Its own name when no other connection has it. Names are not unique (two kubeconfig files may both define `prod`, two EKS
 * clusters of one name may sit in two regions of one file, and all the connections are live, with ids that differ), so connections that share a name get a second word: `<name> · <where>`.
 *
 * When the connections that share a name do not all have the same description, `<where>` is the connection's own description (`prod · EKS · us-east-1 · 111122223333`): the path cannot
 * tell two contexts of one file apart, and the plugin has already said what does. A connection with a blank description among them falls to the path.
 *
 * Otherwise `<where>` is the shortest trailing run of segments of the path of the kubeconfig (the `kubeconfig` label the plugin sets) that tells them apart: `~/.kube/config` and
 * `~/work/other` read `config` and `other`, and `~/.kube/config` and `~/work/config` read `.kube/config` and `work/config`. A connection with no usable label keeps the bare name.
 * The answer depends only on the connection and the list, never on their order.
 */
export function connectionName(connection: Connection, list: readonly Connection[]): string {
  const name = ownName(connection);
  const same = list.filter((other) => ownName(other) === name);
  if (same.length < 2) {
    return name;
  }

  const description = text(connection.description);
  if (description !== '' && new Set(same.map((other) => text(other.description))).size > 1) {
    return `${name}${WHERE_SEPARATOR}${description}`;
  }

  const own = kubeconfigSegments(connection);
  if (own.length === 0) {
    return name;
  }

  const sharing = same.map(kubeconfigSegments).filter((segments) => segments.length > 0);

  // The shortest run, the same length for every connection of the name, after which no two of them read alike; when no run does (the same path twice), the whole path is the most that can be said.
  const longest = Math.max(...sharing.map((segments) => segments.length));
  const tail = (segments: readonly string[], length: number) => segments.slice(-length).join('/');
  let length = 1;
  while (length < longest && new Set(sharing.map((segments) => tail(segments, length))).size < new Set(sharing.map((segments) => segments.join('/'))).size) {
    length += 1;
  }

  return `${name}${WHERE_SEPARATOR}${tail(own, length)}`;
}

/**
 * The connection a page reads. Until the scope menus exist (tier C) the plugin owns what an absent connection means: a route that names none, or one the plugin does not know, takes the
 * plugin's first connection. A route holds an id. The page of a restored tab can hold an old one (before connection ids were derived they were the name of the context) or one of a connection
 * that has since gone: the page is not broken for it. It reads the first connection, and the lane says which one by its name, so the person sees what they are looking at; nothing prints the
 * stale id. While the connections are on their way there is no connection yet, so the page names none (the lane says it is loading) rather than print the route.
 */
export function useChosenConnection(plugin: string, route: string | undefined): PageConnection {
  const { connections } = useConnections({ plugin });
  const list = connections.data ?? [];
  const chosen = list.find((candidate) => candidate.id === route) ?? list[0];
  const pending = connections.isPending;
  return { chosen, pending, named: chosen === undefined ? undefined : connectionName(chosen, list) };
}

/** What a page says when the plugin has no connection (or is not installed): there is nothing to read, and nothing to retry. The lists and the cluster overview say it alike. */
export const NO_CONNECTIONS_TEXT = 'No connections';

/** What the Connection face says before the plugin's connections have answered, and when the plugin has none. */
const WAITING_TEXT = 'Loading…';
const NO_CONNECTION_TEXT = 'None';

/**
 * The scope lane's Connection face. A page declares its lane from its first render, whatever it does not know yet: the host reserves the lane while a plugin loads, and a frame
 * without one gives it back and moves the page by its 40 px (docs/ui-next/status/S1b.md). So the face is always there, and its text is a word while the connection is not known.
 */
export function connectionFace({ named, pending }: Pick<PageConnection, 'named' | 'pending'>): ShellScopeFace {
  return { label: 'Connection', icon: 'server', text: named ?? (pending ? WAITING_TEXT : NO_CONNECTION_TEXT), role: 'connection' };
}

/** The scope lane's Namespaces face: the namespaces the page is read in. */
export function namespacesFace(text: string): ShellScopeFace {
  return { label: 'Namespaces', icon: 'folder-tree', text };
}
