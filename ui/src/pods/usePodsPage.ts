import { useConnections } from '@omniviewdev/runtime/ui/v1';
import { useEffect } from 'react';
import type { ContextV1, FrameV1, ListPageViewV1 } from '../contract/v1';
import { usePods, type PodRow } from './data';
import { podsListSource, type PodsListSource } from './source';

// The Pods page's one data hook (the contribution contract's `usePage`): which connection it reads, the Pods and the state they are in, and how the
// page sits in the frame. The host calls it inside the page's own error boundary and draws what it returns: the frame, and the list with its source.
// The providers the hooks read are the host's, as for any plugin: the QueryClient (docs/ui-next/optimisations.md RTM-14, MNR-D8) and the theme above
// the page, the activity provider beside it.

const NO_ROWS: readonly PodRow[] = [];
const refreshNothing = (): Promise<void> => Promise.resolve();
/** The connections are on their way: the page is loading, with nothing to list. */
const WAITING: PodsListSource = { state: { kind: 'loading' }, rows: NO_ROWS, complete: false, refreshing: false, refresh: refreshNothing };
/** The plugin has no connection (or is not installed): there is nothing to read, and nothing to retry. */
const NO_CONNECTIONS: PodsListSource = { ...WAITING, state: { kind: 'failed', message: 'No connections' } };

/**
 * How the page sits in the frame: the tab, the status bar's path and the scope lane, as plain data. `connection` is the connection the route names
 * (`?connection=` in the hash); without one the lane and the path have no connection to show. A value the page learns from its data (the count of Pods,
 * the connection it picked) reaches the frame when the page that owns the data is wired to it (slice 1a.7).
 */
export function podsFrame(connection: string | undefined): FrameV1 {
  return {
    tab: { title: 'Pods', icon: 'box' },
    path: connection === undefined ? ['Kubernetes', 'Pods'] : ['Kubernetes', connection, 'Pods'],
    scope:
      connection === undefined
        ? undefined
        : [
          { label: 'Connection', icon: 'server', text: connection },
          { label: 'Namespaces', icon: 'folder-tree', text: 'All namespaces' },
        ],
  };
}

// The read chain is `usePods`: the catalog, the resolved target, then the collection of its source view, live when the type advertises it, exactly as
// the old table reads it. A connection is never started by a read, so this page starts the one it finds stopped, once: a development shortcut that
// 1a.7 removes in favour of an explicit Connect (plan D4).
export function usePodsPage({ plugin, route }: ContextV1): ListPageViewV1<PodRow> {
  const { connections } = useConnections({ plugin });
  const list = connections.data ?? [];
  // Until the scope menus exist (tier C) the plugin owns what an absent connection means: a name the plugin does not know, or none, takes its first one.
  const chosen = list.find((candidate) => candidate.id === route.connection) ?? list[0];
  const view = usePods({ pluginID: plugin, connectionID: chosen?.id });
  const { state, connect } = view;
  useEffect(() => {
    if (state.kind === 'disconnected') {
      void connect();
    }
  }, [state.kind, connect]);

  const frame = podsFrame(route.connection);
  if (chosen === undefined) {
    return { frame, source: connections.isPending ? WAITING : NO_CONNECTIONS };
  }

  return { frame, source: podsListSource(view) };
}
