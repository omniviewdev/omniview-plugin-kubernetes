import { describe, expect, it, vi } from 'vitest';

import { NOT_AVAILABLE_YET, notAvailableYet, podCommands, type PodAction } from './commands';

// The commands of a Pod's header, in the mock's order for a Pod (MOCK k8s-resource.js `LAYOUT.Pod`): Logs, Shell, Delete; the overflow menu holds Forward port, Debug container, Events and
// Copy name. Logs is the page's own (P1b-3b: it opens a session in the host's Logs tool, `../logs/command.ts`) and is given to `podCommands`; no other action is wired yet, so the others say why
// they cannot be used, in the kit's pattern.

const logs = { onSelect: vi.fn() };

describe('podCommands: the one order the design allows', () => {
  const commands = podCommands(vi.fn(), logs);

  it('has Logs as the primary, Shell as the one secondary and Delete as the danger command; Refresh is the page\'s, not here', () => {
    expect(commands.primary?.label).toBe('Logs');
    expect(commands.secondary?.map((command) => command.label)).toEqual(['Shell']);
    expect(commands.danger?.label).toBe('Delete');
    expect(commands).not.toHaveProperty('utility');
  });

  it('has the four items of the overflow menu, none of which repeats a button', () => {
    expect(commands.menu?.map((item) => item.label)).toEqual(['Forward port…', 'Debug container…', 'Events', 'Copy name']);
    const buttons = new Set([commands.primary?.id, ...(commands.secondary ?? []).map((command) => command.id), commands.danger?.id]);
    for (const item of commands.menu ?? []) {
      expect(buttons.has(item.id), item.id).toBe(false);
    }
  });

  it('says in one sentence, on each labelled command that is not wired, that it cannot be used yet: the first reason is what the identity line prints', () => {
    const stubs = [...(commands.secondary ?? []), commands.danger];
    expect(stubs.map((command) => command?.label)).toEqual(['Shell', 'Delete']);
    for (const command of stubs) {
      expect(command?.disabledReason).toBe(NOT_AVAILABLE_YET);
    }

    expect(NOT_AVAILABLE_YET).toBe('Shell and Delete are not available yet');
  });

  it('has Logs as the command it was given: it is the page\'s, so it says nothing of being unavailable unless the page says so', () => {
    expect(commands.primary).toEqual({ id: 'logs', label: 'Logs', onSelect: logs.onSelect });
    expect(commands.primary).not.toHaveProperty('disabledReason');
    const refused = podCommands(vi.fn(), { onSelect: logs.onSelect, disabledReason: 'This version of Omniview cannot show logs here.' });
    expect(refused.primary?.disabledReason).toBe('This version of Omniview cannot show logs here.');
    expect(refused.primary?.onSelect).toBe(logs.onSelect);
  });

  it('keeps every menu item unavailable: it stays in the menu, announced as such, and does nothing', () => {
    for (const item of commands.menu ?? []) {
      expect(item.disabled, item.id).toBe(true);
    }
  });
});

describe('podCommands: where an invoked command reports', () => {
  it('routes each stub and each menu item to the one place the real actions replace, with its own name, and Logs to the page\'s own', () => {
    const invoked: PodAction[] = [];
    const open = vi.fn();
    const commands = podCommands(
      (action) => {
        invoked.push(action);
      },
      { onSelect: open },
    );
    for (const command of [commands.primary, ...(commands.secondary ?? []), commands.danger]) {
      command?.onSelect();
    }

    for (const item of commands.menu ?? []) {
      item.onSelect();
    }

    expect(open).toHaveBeenCalledTimes(1);
    expect(invoked).toEqual(['shell', 'delete', 'forward-port', 'debug', 'events', 'copy-name']);
  });

  it('has a stub that does nothing yet and takes every action that is not wired', () => {
    for (const action of ['shell', 'delete', 'forward-port', 'debug', 'events', 'copy-name'] as const) {
      expect(notAvailableYet(action)).toBeUndefined();
    }
  });
});
