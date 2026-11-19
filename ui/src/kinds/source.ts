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

/** What each failure means when the runtime sent no words of its own. `plural` is what the user calls the kind ("Pods"). */
function sentence(kind: KindFailureKind | 'not-found', plural: string): string {
  switch (kind) {
    case 'needs-sign-in': return 'The connection needs you to sign in.';
    case 'denied': return `You do not have access to list ${plural}.`;
    case 'unreachable': return 'The cluster did not answer.';
    case 'unsupported': return `This cluster does not serve ${plural}.`;
    case 'failed': return `${plural} could not be read.`;
    case 'not-found': return 'This connection no longer exists.';
  }
}

function failed<TRow extends KindRow>(kind: KindFailureKind | 'not-found', message: string | undefined, view: KindView<TRow>, plural: string): KindListSourceState {
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

function stateOf<TRow extends KindRow>(view: KindView<TRow>, plural: string): KindListSourceState {
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
      return failure === undefined ? { kind: 'ready' } : failed(failure.kind, failure.message, view, plural);
    case 'unsupported':
      return failed('unsupported', undefined, view, plural);
    case 'needs-sign-in':
    case 'denied':
    case 'unreachable':
    case 'not-found':
    case 'failed':
      return failed(state.kind, state.message, view, plural);
  }
}

/** A kind's view as the list page's source. `plural` is what the user calls the kind ("Pods"), for the words of a failure. */
export function kindListSource<TRow extends KindRow>(view: KindView<TRow>, plural: string): KindListSource<TRow> {
  return { state: stateOf(view, plural), rows: view.rows, complete: view.complete, refreshing: view.refreshing, refresh: view.refresh };
}
