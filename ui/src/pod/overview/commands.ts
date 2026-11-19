import type { PageHeaderCommands } from '@omniviewdev/kit';

// The commands of a Pod's header, in the one order the design allows and the mock's order for a Pod (MOCK k8s-resource.js `LAYOUT.Pod`, design 17 K59): Logs, Shell, Delete, then the
// page's own Refresh, then the overflow menu. No backend action is wired in this step (D1b), so each command says so with the kit's pattern for a command that cannot be used: it stays
// where the design puts it, keeps its focus, does nothing, and the reason is its description and is written once in the identity line (design 14 P2, 04 DR1). The kit does not call
// a command that has a reason, so `invoke` is the one place the real actions replace: every command routes to it.

export type PodAction = 'logs' | 'shell' | 'delete' | 'forward-port' | 'debug' | 'events' | 'copy-name';

/** Why the three labelled commands cannot be used. It is the text of the identity line, so it names them: the first reason of a labelled command is the one the line prints. */
export const NOT_AVAILABLE_YET = 'Logs, Shell and Delete are not available yet';

/**
 * Where a command reports that it was invoked: no action behind it yet. The kit's unavailable pattern keeps a click from ever getting here (`NOT_AVAILABLE_YET`); the real actions
 * (a log session, a shell, the confirmed delete) replace this function, command by command.
 */
export function notAvailableYet(action: PodAction): void {
  void action;
}

export function podCommands(invoke: (action: PodAction) => void): Omit<PageHeaderCommands, 'utility'> {
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
    primary: command('logs', 'Logs'),
    secondary: [command('shell', 'Shell')],
    danger: command('delete', 'Delete'),
    menu: [item('forward-port', 'Forward port…'), item('debug', 'Debug container…'), item('events', 'Events'), item('copy-name', 'Copy name')],
  };
}
