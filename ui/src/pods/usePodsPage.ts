import { useEffect } from 'react';

import { connectionFace, namespacesFace, useChosenConnection, type PageConnection } from '../connection';
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
 * How the page sits in the frame: the tab, the status bar's path and the scope lane, as plain data. The lane is declared from the first render (`connectionFace`): the
 * connection the page reads, once the plugin's connections have answered, or the one the route names while they are on their way. A value the page learns from its data
 * (the count of Pods) reaches the frame when the page that owns the data is wired to it (slice 1a.7).
 */
export function podsFrame(connection: Pick<PageConnection, 'named' | 'pending'>): FrameV1 {
  const { named } = connection;
  return {
    tab: { title: 'Pods', icon: 'box' },
    path: named === undefined ? ['Kubernetes', 'Pods'] : ['Kubernetes', named, 'Pods'],
    scope: [connectionFace(connection), namespacesFace('All namespaces')],
  };
}

// The read chain is `usePods`: the catalog, the resolved target, then the collection of its source view, live when the type advertises it, exactly as
// the old table reads it. A connection is never started by a read, so this page starts the one it finds stopped, once: a development shortcut that
// 1a.7 removes in favour of an explicit Connect (plan D4).
export function usePodsPage({ plugin, route }: ContextV1): ListPageViewV1<PodRow> {
  const connection = useChosenConnection(plugin, route.connection);
  const { chosen, pending } = connection;
  const view = usePods({ pluginID: plugin, connectionID: chosen?.id });
  const { state, connect } = view;
  useEffect(() => {
    if (state.kind === 'disconnected') {
      void connect();
    }
  }, [state.kind, connect]);

  const frame = podsFrame(connection);
  if (chosen === undefined) {
    return { frame, source: pending ? WAITING : NO_CONNECTIONS };
  }

  return { frame, source: podsListSource(view) };
}
