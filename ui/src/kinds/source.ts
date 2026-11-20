import { scopeText, type NamespaceScope } from '../sidebar/scope';

import type { KindRow } from './definition';
import type { KindFailureKind } from './state';
import type { KindView } from './useKindRows';

// What a kind's data layer tells the list page, in the page's words: the contribution contract's `ListSource<TRow>` written out (`../contract/page.ts`). The page's `satisfies ListPageV1<TRow>`
// in `list.tsx` checks the two against each other.

export type KindListSourceState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly message?: string | undefined; readonly retry?: (() => void) | undefined };

export type KindListSource<TRow extends KindRow> = {
  readonly state: KindListSourceState;
  readonly rows: readonly TRow[];
  readonly complete: boolean;
  readonly refreshing: boolean;
  readonly refresh: () => Promise<void>;
};

/** The words a failure is said in: what the user calls the kind ("Pods"), and the sentence for a list the user may not read. */
type Words = { readonly plural: string; readonly refusal: string };

/** What each failure means when the runtime sent no words of its own. A refusal is not here: it is never said in the runtime's words, or in words the runtime may have sent (`failed`). */
function sentence(kind: Exclude<KindFailureKind | 'not-found', 'denied'>, plural: string): string {
  switch (kind) {
    case 'needs-sign-in': return 'The connection needs you to sign in.';
    case 'unreachable': return 'The cluster did not answer.';
    case 'unsupported': return `This cluster does not serve ${plural}.`;
    case 'failed': return `${plural} could not be read.`;
    case 'not-found': return 'This connection no longer exists.';
  }
}

function failed<TRow extends KindRow>(kind: KindFailureKind | 'not-found', message: string | undefined, view: KindView<TRow>, { plural, refusal }: Words): KindListSourceState {
  // A list the user may not read: asking again cannot change that, so the page offers no Retry (the contract draws one only when the source gives it), and the words are the plugin's own. The runtime's
  // text for a refusal is a fixed one that says nothing, and what a server wrote is not put on the screen, so `message` is not shown.
  if (kind === 'denied') {
    return { kind: 'failed', message: refusal };
  }

  const said = message ?? sentence(kind, plural);
  // Where asking again cannot help (a cluster that serves no such type, a connection that is gone) a Retry would be a button that does nothing.
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

function stateOf<TRow extends KindRow>(view: KindView<TRow>, words: Words): KindListSourceState {
  const { state, failure } = view;
  switch (state.kind) {
    // The page starts a connection it finds stopped (a dev shortcut that 1a.7 removes), so a stopped one is a wait.
    case 'connecting':
    case 'disconnected':
    case 'loading':
      return { kind: 'loading' };
    case 'empty':
      return { kind: 'ready' };
    case 'loaded':
      // A failure that came after rows is kept beside them: the page keeps listing and does not call a refresh an update.
      return failure === undefined ? { kind: 'ready' } : failed(failure.kind, failure.message, view, words);
    case 'unsupported':
      return failed('unsupported', undefined, view, words);
    case 'needs-sign-in':
    case 'denied':
    case 'unreachable':
    case 'not-found':
    case 'failed':
      return failed(state.kind, state.message, view, words);
  }
}

/**
 * A kind's view as the list page's source. `plural` is what the user calls the kind ("Pods"), for the words of a failure; `scope` is the namespaces the list reads (there is no namespace menu yet, so the page
 * says all of them), which the words of a refusal name for a kind that lives in a namespace, and "this cluster" for one that does not (and when the catalog has not said which it is: true of either).
 */
export function kindListSource<TRow extends KindRow>(view: KindView<TRow>, plural: string, scope: NamespaceScope): KindListSource<TRow> {
  const where = view.namespaced === true ? scopeText(scope) : 'this cluster';
  const words = { plural, refusal: `You do not have permission to list ${plural} in ${where}.` };
  return { state: stateOf(view, words), rows: view.rows, complete: view.complete, refreshing: view.refreshing, refresh: view.refresh };
}
