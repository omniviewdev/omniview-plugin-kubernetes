import type { PageHeaderCommands } from '@omniviewdev/kit';

import type { PodForwardCommand } from '../forward/command';
import type { PodLogsCommand } from '../logs/command';

// The commands of a Pod's header, in the one order the design allows and the mock's order for a Pod (MOCK k8s-resource.js `LAYOUT.Pod`, design 17 K59): Logs, Shell, Delete, then the
// page's own Refresh, then the overflow menu. Logs is the page's own (P1b-3b: it opens a session in the host's Logs tool, `../logs/command.ts`) and is given here, and so are the entries that
// forward a port of the Pod (PF3: they ask the host to start the forward, `../forward/command.ts`), which stand where the menu's `Forward port…` is; it stays, unavailable, when the page gives none.
// No other backend action is wired yet (D1b), so each of the others says so with the kit's pattern for a command that cannot be used: it stays where the design puts it, keeps its focus, does
// nothing, and the reason is its description and is written once in the identity line (design 14 P2, 04 DR1). The kit does not call a command that has a reason, so `invoke` is the one place the
// real actions replace: every command that is not wired routes to it.

export type PodAction = 'shell' | 'delete' | 'forward-port' | 'debug' | 'events' | 'copy-name';

/** Why the two labelled commands that are not wired cannot be used. It is the text of the identity line, so it names them: the first reason of a labelled command is the one the line prints. */
export const NOT_AVAILABLE_YET = 'Shell and Delete are not available yet';

/**
 * Where a command reports that it was invoked: no action behind it yet. The kit's unavailable pattern keeps a click from ever getting here (`NOT_AVAILABLE_YET`); the real actions
 * (a shell, the confirmed delete) replace this function, command by command.
 */
export function notAvailableYet(action: PodAction): void {
  void action;
}

export function podCommands(invoke: (action: PodAction) => void, logs: PodLogsCommand, forward: PodForwardCommand): Omit<PageHeaderCommands, 'utility'> {
  const command = (id: PodAction, label: string) => ({
    id,
    label,
    onSelect: () => {
      invoke(id);
    },
    disabledReason: NOT_AVAILABLE_YET,
  });
  const item = (id: PodAction, label: string) => ({
    id,
    label,
    onSelect: () => {
      invoke(id);
    },
    disabled: true,
  });
  return {
    primary: { id: 'logs', label: 'Logs', onSelect: logs.onSelect, ...(logs.disabledReason === undefined ? {} : { disabledReason: logs.disabledReason }) },
    secondary: [command('shell', 'Shell')],
    danger: command('delete', 'Delete'),
    menu: [...(forward.entries.length === 0 ? [item('forward-port', 'Forward port…')] : forward.entries), item('debug', 'Debug container…'), item('events', 'Events'), item('copy-name', 'Copy name')],
  };
}
