import type { ConnectionReadinessPhase } from '@omniviewdev/runtime/ui/v1';

import type { DetailState } from '../contract/v1';
import { connectionSentence } from '../kinds/source';
import { connectionState } from '../kinds/state';

/**
 * The state of the page while its connection is not ready, or nothing when it is (what the page reads then decides what it says). The overview lists no kind, so it asks the phase of the connection alone
 * (`connectionState`, the first thing a kind's list asks too) and says what the Pods list says for it, in the detail page's words:
 *
 * - the connection is starting (checking, connecting, or stopped: the page starts a stopped one itself): the page is loading;
 * - it needs sign-in, or the cluster did not answer: failed, with the runtime's words when it gave some and the plugin's own sentence when it gave none, and a Retry that asks the connection again;
 * - it is gone: failed, with nothing to retry, because asking again cannot bring it back;
 * - the user may not use it: denied, in the host's own words, with no Retry: a refusal is the same however often it is asked.
 */
export function pageState(phase: ConnectionReadinessPhase, message: string | undefined, retry: () => void): DetailState | undefined {
  const state = connectionState(phase, message);
  if (state === undefined) {
    return undefined;
  }

  switch (state.kind) {
    case 'connecting':
    case 'disconnected':
      return { kind: 'loading' };
    case 'needs-sign-in':
    case 'unreachable':
      return { kind: 'failed', message: state.message ?? connectionSentence(state.kind), retry };
    case 'not-found':
      return { kind: 'failed', message: state.message ?? connectionSentence('not-found') };
    case 'denied':
      return { kind: 'denied' };
  }
}
