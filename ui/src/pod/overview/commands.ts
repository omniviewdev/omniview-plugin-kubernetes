import type { PageHeaderCommands } from '@omniviewdev/kit';

import type { PodForwardCommand } from '../forward/command';
import type { PodLogsCommand } from '../logs/command';
import type { PodShellCommand } from '../terminal/command';

// Logs, Shell and Forward port use the host's respective panel handles. The other commands retain the kit's
// unavailable presentation. The shell command carries explicit container choices for multi-container Pods.
export type PodAction = 'delete' | 'forward-port' | 'debug' | 'events' | 'copy-name';

/** Where a still-unavailable header command reports an invocation; the kit never dispatches a disabled item. */
export function notAvailableYet(action: PodAction): void {
  void action;
}

export function podCommands(
  invoke: (action: PodAction) => void,
  logs: PodLogsCommand,
  forward: PodForwardCommand,
  shell: PodShellCommand,
): Omit<PageHeaderCommands, 'utility'> {
  const item = (id: PodAction, label: string) => ({
    id,
    label,
    onSelect: () => {
      invoke(id);
    },
    disabled: true,
  });
  return {
    primary: {
      id: 'logs',
      label: 'Logs',
      onSelect: logs.onSelect,
      ...(logs.disabledReason === undefined ? {} : { disabledReason: logs.disabledReason }),
    },
    secondary: [shell.button],
    danger: {
      id: 'delete',
      label: 'Delete',
      onSelect: () => invoke('delete'),
      disabledReason: 'Delete is not available yet.',
    },
    menu: [
      ...shell.entries,
      ...(forward.entries.length === 0 ? [item('forward-port', 'Forward port…')] : forward.entries),
      item('debug', 'Debug container…'),
      item('events', 'Events'),
      item('copy-name', 'Copy name'),
    ],
  };
}
