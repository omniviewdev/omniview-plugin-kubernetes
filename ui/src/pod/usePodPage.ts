import { compactAge, useAge } from '@omniviewdev/kit';
import { useEffect, useMemo } from 'react';

import { connectionFace, namespacesFace, useChosenConnection } from '../connection';
import type { ContextV1, DetailPageViewV1, DetailSource, DetailState } from '../contract/v1';
import type { KindFailureKind } from '../kinds/state';

import { usePod, type PodView } from './data/usePod';
import { podLogsCommand } from './logs/command';
import { notAvailableYet } from './overview/commands';
import { podOverview } from './overview/model';
import { podView } from './overview/view';

// The Pod page's one data hook (the contribution contract's `usePage` of a detail page): which connection it reads, the Pod and the state it is in, and the scope it sits in.
// The host calls it inside the page's own error boundary with the route's parameters (`namespace` and `name`: the identity the definition names) and draws what it returns:
// the lane's faces, and the object's source. The page never reads a data layer itself: the providers the hooks read are the host's (the QueryClient, the theme above the page).

/**
 * What the page says of each failure. The runtime's own words are used only for a failure the data layer could not classify (`failed`): for a classified one they are the host's fixed
 * sentence (a denial and a sign-in always get the same generic text) or the raw detail of a connection that failed, so the page says the cause itself (the interim of B-02 and B-07 in
 * the host's docs/ui-next/status/D1b.md).
 */
const SENTENCE: Readonly<Record<KindFailureKind | 'not-found', string>> = {
  'needs-sign-in': 'The connection needs you to sign in.',
  denied: 'You do not have access to read this Pod.',
  unreachable: 'The cluster did not answer.',
  unsupported: 'This cluster does not serve Pods.',
  failed: 'The Pod could not be read.',
  'not-found': 'This connection no longer exists.',
};

function failed(kind: KindFailureKind | 'not-found', message: string | undefined, view: PodView): DetailState {
  const said = kind === 'failed' && message !== undefined && message !== '' ? message : SENTENCE[kind];
  // Where asking again cannot help (a cluster that serves no Pods, a connection that is gone) a Retry would be a button that does nothing.
  if (kind === 'unsupported' || kind === 'not-found') {
    return { kind: 'failed', message: said };
  }

  return {
    kind: 'failed',
    message: said,
    retry: () => {
      void view.retry();
    },
  };
}

/** The state of the page: the Pods data layer's own words for the connection and the read, in the detail page's. */
export function detailState(view: PodView, namespace: string, name: string): DetailState {
  const { state, failure } = view;
  switch (state.kind) {
    // The page starts a connection it finds stopped (a dev shortcut that 1a.7 removes), so a stopped one is a wait.
    case 'connecting':
    case 'disconnected':
    case 'loading':
      return { kind: 'loading' };
    case 'empty':
      // The namespace was read whole and the Pod is not in it. When the page had the Pod, its source has said it is gone: it was deleted while the page was open, and the title says so (the mock's "<name> was deleted" over
      // "It no longer exists in <where>."). Otherwise it never was there for this page: no title, so the page's own, "<name> was not found", stands over the message.
      return view.deleted
        ? { kind: 'not-found', title: `${name} was deleted`, message: `It no longer exists in namespace ${namespace}.` }
        : { kind: 'not-found', message: `Pod ${name} doesn't exist in namespace ${namespace}. It may have been deleted.` };
    case 'loaded':
      // A failure that came after the Pod is kept beside it: the page keeps showing it and says so in the header.
      return failure === undefined ? { kind: 'ready' } : failed(failure.kind, failure.message, view);
    case 'denied':
      return { kind: 'denied', message: SENTENCE.denied };
    case 'unsupported':
      return failed('unsupported', undefined, view);
    case 'needs-sign-in':
    case 'unreachable':
    case 'not-found':
    case 'failed':
      return failed(state.kind, state.message, view);
  }
}

// The read chain is `usePod` (INTERIM, see its file). A connection is never started by a read, so this page starts the one it finds stopped, once: the same development shortcut as
// the Pods page, which 1a.7 removes in favour of an explicit Connect (plan D4). The header's Logs command is the page's own (`./logs/command.ts`): it opens a session in the host's Logs tool through
// the panel handle the host gave the page, from the record this hook holds.
export function usePodPage({ plugin, route, panel }: ContextV1): DetailPageViewV1 {
  const namespace = route.params.namespace ?? '';
  const name = route.params.name ?? '';
  const connection = useChosenConnection(plugin, route.connection);
  const view = usePod({ pluginID: plugin, connectionID: connection.chosen?.id, namespace, name });
  const { pod, record, state, connect } = view;
  useEffect(() => {
    if (state.kind === 'disconnected') {
      void connect();
    }
  }, [state.kind, connect]);

  // The identity a route names is two parameters: without them there is no Pod to read, and none to find.
  const named = namespace !== '' && name !== '';
  const age = useAge(pod?.metadata.creationTimestamp, compactAge);
  const overview = useMemo(() => (pod === undefined ? undefined : podOverview(pod)), [pod]);
  const status = named ? detailState(view, namespace, name) : ({ kind: 'not-found' } satisfies DetailState);
  const source: DetailSource = {
    state: status,
    // The Pod is on screen while it is read, and after a failure that came once it was: a failure does not take away what was shown.
    view:
      overview !== undefined && pod !== undefined && record !== undefined && (status.kind === 'ready' || status.kind === 'failed')
        ? podView(overview, { age, invoke: notAvailableYet, logs: podLogsCommand({ plugin, panel, record, pod, namespace, name, scope: connection.named ?? '', route }) })
        : undefined,
    refreshing: view.refreshing,
    refresh: view.refresh,
  };

  // The lane is declared from the first render, whatever is not known yet (`connectionFace`): the host reserves it while a plugin loads, and a page that gains it later moves.
  return { scope: [connectionFace(connection), namespacesFace(namespace === '' ? 'Unknown' : namespace)], source };
}
