import { useConnections, type Connection } from '@omniviewdev/runtime/ui/v1';

import type { ShellScopeFace } from './contract/v1';

// The connection a page of this plugin reads, and how its scope lane names it. Every page of the plugin shares this one answer, so the Pods list and the page of one Pod
// read the same connection for the same route and say the same thing in the lane.

export type PageConnection = {
  /** The connection the page reads. Absent while the plugin's connections are on their way, and when the plugin has none. */
  readonly chosen: Connection | undefined;
  /** The plugin's connections are on their way. */
  readonly pending: boolean;
  /**
   * The name the frame gives the connection (the scope lane, the status bar's path): the one the page reads; while the connections are on their way, the one the route names;
   * undefined when the route names none, or the plugin has none.
   */
  readonly named: string | undefined;
};

/**
 * The connection a page reads. Until the scope menus exist (tier C) the plugin owns what an absent connection means: a name the plugin does not know, or none, takes the
 * plugin's first one.
 */
export function useChosenConnection(plugin: string, route: string | undefined): PageConnection {
  const { connections } = useConnections({ plugin });
  const list = connections.data ?? [];
  const chosen = list.find((candidate) => candidate.id === route) ?? list[0];
  const pending = connections.isPending;
  return { chosen, pending, named: chosen?.id ?? (pending ? route : undefined) };
}

/** What the Connection face says before the plugin's connections have answered, and when the plugin has none. */
const WAITING_TEXT = 'Loading…';
const NO_CONNECTION_TEXT = 'None';

/**
 * The scope lane's Connection face. A page declares its lane from its first render, whatever it does not know yet: the host reserves the lane while a plugin loads, and a frame
 * without one gives it back and moves the page by its 40 px (docs/ui-next/status/S1b.md). So the face is always there, and its text is a word while the connection is not known.
 */
export function connectionFace({ named, pending }: Pick<PageConnection, 'named' | 'pending'>): ShellScopeFace {
  return { label: 'Connection', icon: 'server', text: named ?? (pending ? WAITING_TEXT : NO_CONNECTION_TEXT) };
}

/** The scope lane's Namespaces face: the namespaces the page is read in. */
export function namespacesFace(text: string): ShellScopeFace {
  return { label: 'Namespaces', icon: 'folder-tree', text };
}
