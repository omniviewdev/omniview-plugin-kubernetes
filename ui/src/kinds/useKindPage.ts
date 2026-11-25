import { useEffect } from 'react';

import { connectionFace, namespacesFace, NO_CONNECTIONS_TEXT, useChosenConnection, type PageConnection } from '../connection';
import type { ContextV1, FrameV1, ListPageViewV1 } from '../contract/v1';
import { sidebarCount } from '../sidebar/count';
import { openKey, publishOpenCount } from '../sidebar/openCounts';
import { ALL_NAMESPACES } from '../sidebar/scope';

import type { KindDefinition, KindRow } from './definition';
import { kindListSource, type KindListSource } from './source';
import { useKindRows } from './useKindRows';

// A kind's list page's one data hook (the contribution contract's `usePage`): which connection it reads, the objects of the kind and the state they are in, and how the
// page sits in the frame. The host calls it inside the page's own error boundary and draws what it returns: the frame, and the list with its source.
// The providers the hooks read are the host's, as for any plugin: the QueryClient (docs/ui-next/optimisations.md RTM-14, MNR-D8) and the theme above
// the page, the activity provider beside it.

const refreshNothing = (): Promise<void> => Promise.resolve();
/** The connections are on their way: the page is loading, with nothing to list. */
const WAITING: KindListSource<never> = { state: { kind: 'loading' }, rows: [], complete: false, refreshing: false, refresh: refreshNothing };
/** The plugin has no connection (or is not installed): there is nothing to read, and nothing to retry. */
const NO_CONNECTIONS: KindListSource<never> = { ...WAITING, state: { kind: 'failed', message: NO_CONNECTIONS_TEXT } };

/**
 * How the page sits in the frame: the tab, the status bar's path and the scope lane, as plain data. The lane is declared from the first render (`connectionFace`): the
 * connection the page reads, once the plugin's connections have answered, or the one the route names while they are on their way. A value the page learns from its data
 * (the count of objects) reaches the frame when the page that owns the data is wired to it (slice 1a.7).
 */
export function kindFrame(kind: Pick<KindDefinition<KindRow>, 'nouns' | 'tile'>, connection: Pick<PageConnection, 'named' | 'pending'>): FrameV1 {
  const { named } = connection;
  const title = kind.nouns.other;
  return {
    tab: { title, icon: kind.tile.icon },
    path: named === undefined ? ['Kubernetes', title] : ['Kubernetes', named, title],
    scope: [connectionFace(connection), namespacesFace('All namespaces')],
  };
}

// The read chain is `useKindRows`: the catalog, the resolved target, then the collection of its source view, live when the type advertises it, exactly as
// the old table reads it. A connection is never started by a read, so this page starts the one it finds stopped, once: a development shortcut that
// 1a.7 removes in favour of an explicit Connect (plan D4).
//
// A page that is open says how many objects its kind has to the sidebar (`sidebar/openCounts.ts`), which draws that number for the kind and reads no page of one for it (Q2): the count is the list's own, live,
// from the very source it lists. It is the number of the rows once the whole set is here, and until then the count the first page says it holds (exact, an estimate, or none). The page takes it back when it goes.
export function useKindPage<TRow extends KindRow>(kind: KindDefinition<TRow>, { plugin, route }: ContextV1): ListPageViewV1<TRow> {
  const connection = useChosenConnection(plugin, route.connection);
  const { chosen, pending } = connection;
  const view = useKindRows(kind, { pluginID: plugin, connectionID: chosen?.id });
  const { state, connect } = view;
  useEffect(() => {
    if (state.kind === 'disconnected') {
      void connect();
    }
  }, [state.kind, connect]);

  const connectionId = chosen?.id;
  // A list that was refused says no count, whatever it still holds: the rows kept beside a refusal are what the user could list before it, not how many objects the kind has now, and the refusal is the page's one answer.
  const refused = view.state.kind === 'denied' || view.failure?.kind === 'denied';
  const countKind = refused ? undefined : view.complete ? 'exact' : view.firstCount?.kind;
  const countValue = refused ? undefined : view.complete ? String(view.rows.length) : view.firstCount?.value;
  useEffect(() => {
    if (connectionId === undefined) {
      return undefined;
    }

    return publishOpenCount(openKey(plugin, connectionId, kind.type), sidebarCount(countKind === undefined ? undefined : { kind: countKind, value: countValue }));
  }, [plugin, connectionId, kind.type, countKind, countValue]);

  const frame = kindFrame(kind, connection);
  if (chosen === undefined) {
    return { frame, source: pending ? WAITING : NO_CONNECTIONS };
  }

  // A list reads every namespace, as the lane says; there is no namespace menu yet.
  return { frame, source: kindListSource(view, kind.nouns.other, ALL_NAMESPACES) };
}
