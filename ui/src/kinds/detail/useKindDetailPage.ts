import { compactAge, useAge, type LinkTarget } from '@omniviewdev/kit';
import { useEffect, useMemo } from 'react';

import { connectionFace, namespacesFace, useChosenConnection } from '../../connection';
import type { ContextV1, DetailPageViewV1, DetailSource, DetailState } from '../../contract/v1';
import type { KindCommands, KindDefinition, KindDetail, KindRow } from '../definition';
import type { KindFailureKind } from '../state';

import type { KindOverview, ObjectRef } from './overview';
import { useKindObject, type KindObjectView } from './useKindObject';
import { detailView } from './view';

// The page of one object's data hook, for every kind (the contribution contract's `usePage` of a detail page): which connection it reads, the object and the state it is in, and the scope it sits in. The
// host calls it inside the page's own error boundary with the route's parameters (the identity the kind's definition names) and draws what it returns: the lane's faces, and the object's source. It is the
// Pod page's hook (`pod/usePodPage.ts`) generalised, and it knows no kind: what differs between kinds is the definition's `detail`.

/** A kind that has a generic page: its definition has an overview. */
export type DetailedKind<TRow extends KindRow = KindRow> = KindDefinition<TRow> & { readonly detail: KindDetail & { readonly overview: NonNullable<KindDetail['overview']> } };

/** Whether the kind has a page of one object that the generic page draws. */
export const hasOverview = <TRow extends KindRow>(kind: KindDefinition<TRow>): kind is DetailedKind<TRow> => kind.detail?.overview !== undefined;

/** What the page says an object is: its kind and its plural, its name, and where it lives (`namespace` is undefined for a kind that lives in no namespace). */
export type ObjectWords = {
  readonly kind: string;
  readonly plural: string;
  readonly name: string;
  readonly namespace: string | undefined;
};

/**
 * What the page says of each failure. The runtime's own words are used only for a failure the data layer could not classify (`failed`): for a classified one they are the host's fixed sentence (a denial and a
 * sign-in always get the same generic text) or the raw detail of a connection that failed, so the page says the cause itself. A refusal is never said in the runtime's words: the plugin's own sentence
 * names what the user may not read (decision on the lists, Q2), and asking again cannot change it, so it has no Retry.
 */
function sentence(kind: Exclude<KindFailureKind | 'not-found', 'denied'>, { kind: noun, plural }: ObjectWords): string {
  switch (kind) {
    case 'needs-sign-in': return 'The connection needs you to sign in.';
    case 'unreachable': return 'The cluster did not answer.';
    case 'unsupported': return `This cluster does not serve ${plural}.`;
    case 'failed': return `The ${noun} could not be read.`;
    case 'not-found': return 'This connection no longer exists.';
  }
}

const whereOf = ({ namespace }: ObjectWords): string => (namespace === undefined ? 'this cluster' : `namespace ${namespace}`);

function failed(kind: KindFailureKind | 'not-found', message: string | undefined, view: KindObjectView, words: ObjectWords): DetailState {
  if (kind === 'denied') {
    return { kind: 'failed', message: `You do not have permission to read ${words.kind} ${words.name} in ${whereOf(words)}.` };
  }

  const said = kind === 'failed' && message !== undefined && message !== '' ? message : sentence(kind, words);
  // Where asking again cannot help (a cluster that serves no such kind, a connection that is gone) a Retry would be a button that does nothing.
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

/** The state of the page: the data layer's own words for the connection and the read, in the detail page's. */
export function detailState(view: KindObjectView, words: ObjectWords): DetailState {
  const { state, failure } = view;
  switch (state.kind) {
    // The page starts a connection it finds stopped (a dev shortcut that 1a.7 removes), so a stopped one is a wait.
    case 'connecting':
    case 'disconnected':
    case 'loading':
      return { kind: 'loading' };
    case 'empty':
      // The object's snapshot was read whole and it is not in it. When the page had the object, its source has said it is gone: it was deleted while the page was open. Otherwise it never was there for this page.
      return {
        kind: 'not-found',
        message: view.deleted
          ? `${words.kind} ${words.name} was deleted. It no longer exists in ${whereOf(words)}.`
          : `${words.kind} ${words.name} doesn't exist in ${whereOf(words)}. It may have been deleted.`,
      };
    case 'loaded':
      // A failure that came after the object is kept beside it: the page keeps showing it and says so in the header.
      return failure === undefined ? { kind: 'ready' } : failed(failure.kind, failure.message, view, words);
    case 'denied':
      return { kind: 'denied', message: `You do not have permission to read ${words.kind} ${words.name} in ${whereOf(words)}.` };
    case 'unsupported':
      return failed('unsupported', undefined, view, words);
    case 'needs-sign-in':
    case 'unreachable':
    case 'not-found':
    case 'failed':
      return failed(state.kind, state.message, view, words);
  }
}

/**
 * The hook of the page of a kind's object. The read chain is `useKindObject`. A connection is never started by a read, so this page starts the one it finds stopped, once: the same development
 * shortcut as the lists and the Pod page, which 1a.7 removes in favour of an explicit Connect (plan D4). `resolve` says where a reference to another object goes (the registry knows the pages of the plugin).
 */
export function useKindDetailPage(kind: DetailedKind, { plugin, route }: ContextV1, resolve: (ref: ObjectRef) => LinkTarget | undefined): DetailPageViewV1 {
  const inNamespace = kind.detail.identity.length === 2;
  const name = route.params.name ?? '';
  const namespace = inNamespace ? (route.params.namespace ?? '') : undefined;
  const connection = useChosenConnection(plugin, route.connection);
  const view = useKindObject(kind, { pluginID: plugin, connectionID: connection.chosen?.id, namespace, name });
  const { record, state, connect } = view;
  useEffect(() => {
    if (state.kind === 'disconnected') {
      void connect();
    }
  }, [state.kind, connect]);

  // The identity a route names is its name, and its namespace for a kind that lives in one: without them there is no object to read, and none to find.
  const named = name !== '' && namespace !== '';
  const { overview: overviewOf, commands: commandsOf } = kind.detail;
  const { overview, commands } = useMemo<{ readonly overview?: KindOverview; readonly commands?: KindCommands }>(
    () => (record === undefined ? {} : { overview: overviewOf(record), commands: commandsOf?.(record) }),
    [overviewOf, commandsOf, record],
  );
  const age = useAge(overview?.createdAt, compactAge);
  const status: DetailState = named ? detailState(view, { kind: kind.kind, plural: kind.nouns.other, name, namespace }) : { kind: 'not-found' };
  const source: DetailSource = {
    state: status,
    // The object is on screen while it is read, and after a failure that came once it was: a failure does not take away what was shown.
    view: overview !== undefined && (status.kind === 'ready' || status.kind === 'failed') ? detailView(overview, { kind: kind.kind, namespace, age, commands, resolve }) : undefined,
    refreshing: view.refreshing,
    refresh: view.refresh,
  };

  // The lane is declared from the first render, whatever is not known yet (`connectionFace`): the host reserves it while a plugin loads, and a page that gains it later moves.
  return { scope: [connectionFace(connection), ...(namespace === undefined ? [] : [namespacesFace(namespace === '' ? 'Unknown' : namespace)])], source };
}
