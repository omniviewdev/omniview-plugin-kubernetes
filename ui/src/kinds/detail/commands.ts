import type { PageHeaderCommands } from '@omniviewdev/kit';

import type { KindCommands } from '../definition';

// The commands of an object's header, laid out as the mock lays them out for the kind (MOCK k8s-resource.js `LAYOUT`; K59: Scale, Restart, Logs, Delete, and the overflow menu) and offered with the kit's
// pattern for a command that cannot be used yet: it stays where the design puts it, keeps its focus, does nothing, and the reason is its description and is written once in the identity line (design 14
// P2, 04 DR1). The kit does not call a command that has a reason. None of these has a backend behind it from the new UI (the status file of the step says what each needs), so the one place a real action
// replaces a command is here, command by command, when its backend exists.

/** The labelled commands of the layout, in the order they are drawn: the primary one, the secondaries, the danger one. */
const labelled = ({ primary, secondary = [], danger }: KindCommands) => [primary, ...secondary, danger].flatMap((command) => (command === undefined ? [] : [command.label]));

/** `Scale, Restart, Logs and Delete are not available yet`: the reason of each labelled command, which the identity line prints once. Nothing for a kind that lays out none. */
export function reasonOf(commands: KindCommands | undefined): string | undefined {
  const names = commands === undefined ? [] : labelled(commands);
  if (names.length === 0) {
    return undefined;
  }

  const last = names.at(-1);
  const list = names.length === 1 ? (last ?? '') : `${names.slice(0, -1).join(', ')} and ${last ?? ''}`;
  return `${list} ${names.length === 1 ? 'is' : 'are'} not available yet`;
}

/** The header's commands for the layout, each unavailable with its reason. A kind that lays out none has no commands but the page's own Refresh. */
export function unavailableCommands(layout: KindCommands | undefined): Omit<PageHeaderCommands, 'utility'> | undefined {
  const disabledReason = reasonOf(layout);
  if (layout === undefined) {
    return undefined;
  }

  // The kit never calls a command that has a reason: there is nothing here for a click to do.
  const none = (): void => undefined;
  const command = ({ id, label }: { readonly id: string; readonly label: string }) => ({ id, label, onSelect: none, ...(disabledReason === undefined ? {} : { disabledReason }) });
  const commands: Omit<PageHeaderCommands, 'utility'> = {
    ...(layout.primary === undefined ? {} : { primary: command(layout.primary) }),
    ...(layout.secondary === undefined || layout.secondary.length === 0 ? {} : { secondary: layout.secondary.map(command) }),
    ...(layout.danger === undefined ? {} : { danger: command(layout.danger) }),
    ...(layout.menu === undefined || layout.menu.length === 0 ? {} : { menu: layout.menu.map(({ id, label }) => ({ id, label, onSelect: none, disabled: true })) }),
  };
  return Object.keys(commands).length === 0 ? undefined : commands;
}
