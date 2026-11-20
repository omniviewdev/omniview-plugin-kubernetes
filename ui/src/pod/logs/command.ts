import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import type { PanelHostV1, RouteV1 } from '../../contract/v1';
import type { PodDetail } from '../data/object';

import { logsUnavailable } from './availability';
import { podLogTarget } from './target';

// The Logs command of a Pod's header: what pressing it does, and why it cannot be pressed. It asks the host, through the panel handle the host gave the page (`ctx.panel`), to open a session in
// ITS Logs tool for this Pod's descriptor (`./target.ts`). A host that predates the handle leaves it absent, and the contract's rule is that a plugin that needs it tests for it: the command
// then says so, in the kit's pattern for a command that cannot be used (it stays where the design puts it, keeps its focus, does nothing, and the reason is its description).

/** Why Logs cannot be pressed on a host that gave the page no panel handle (a host from before P1b-3a): the sentence the contract's spec for this step gives. */
export const NO_PANEL = 'This version of Omniview cannot show logs here.';

export type PodLogsInputs = {
  /** The id the plugin is installed under, which the host tells a page. */
  readonly plugin: string;
  /** What the host gave the page to ask of the bottom panel; absent on a host that predates it. */
  readonly panel: PanelHostV1 | undefined;
  /** The Pod's record as the host holds it, and the decoded Pod the page reads from it. */
  readonly record: HostRecord;
  readonly pod: PodDetail;
  /** The Pod's identity: the namespace and the name its page was asked for. */
  readonly namespace: string;
  readonly name: string;
  /** What the frame calls the connection: the tab's muted qualifier. */
  readonly scope: string;
  /** The page the command is on, which is the Pod's own. */
  readonly route: RouteV1;
};

/** What the header's command needs: the callback and, when it cannot be pressed, why. The reason is absent (never `undefined` as a value) when there is none. */
export type PodLogsCommand = {
  readonly onSelect: () => void;
  readonly disabledReason?: string | undefined;
};

/**
 * The Logs command of one Pod. The host's reason comes first: a host that cannot show logs cannot show them when the Pod has started a container either. Pressing it again for the same Pod asks the
 * host again with the same descriptor id; what the host does with a Pod that already has a session is the host's (P1b-3a opens another, as a twin: see the status file of this step).
 */
export function podLogsCommand({ panel, pod, ...target }: PodLogsInputs): PodLogsCommand {
  const reason = panel === undefined ? NO_PANEL : logsUnavailable(pod);
  return {
    onSelect: () => {
      if (panel === undefined || reason !== undefined) {
        return;
      }

      // `undefined` is the host saying it could not (the plugin is not live, the stream could not be made): its console has the reason, and there is no surface for a plugin to say more.
      panel.logs.open(podLogTarget(target));
    },
    ...(reason === undefined ? {} : { disabledReason: reason }),
  };
}
