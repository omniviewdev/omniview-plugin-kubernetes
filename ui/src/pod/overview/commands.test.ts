import { describe, expect, it, vi } from 'vitest';

import { NOT_AVAILABLE_YET, notAvailableYet, podCommands, type PodAction } from './commands';

// The commands of a Pod's header, in the mock's order for a Pod (MOCK k8s-resource.js `LAYOUT.Pod`): Logs, Shell, Delete; the overflow menu holds Forward port, Debug container, Events and
// Copy name. No action is wired in D1b, so the labelled ones say why they cannot be used, in the kit's pattern.

describe('podCommands: the one order the design allows', () => {
  const commands = podCommands(vi.fn());

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

  it('says in one sentence, on each labelled command, that none of the three can be used yet: the first reason is what the identity line prints', () => {
    const labelled = [commands.primary, ...(commands.secondary ?? []), commands.danger];
    expect(labelled).toHaveLength(3);
    for (const command of labelled) {
      expect(command?.disabledReason).toBe(NOT_AVAILABLE_YET);
    }

    expect(NOT_AVAILABLE_YET).toBe('Logs, Shell and Delete are not available yet');
  });

  it('keeps every menu item unavailable: it stays in the menu, announced as such, and does nothing', () => {
    for (const item of commands.menu ?? []) {
      expect(item.disabled, item.id).toBe(true);
    }
  });
});

describe('podCommands: where an invoked command reports', () => {
  it('routes each command and each menu item to the one place the real actions replace, with its own name', () => {
    const invoked: PodAction[] = [];
    const commands = podCommands((action) => {
      invoked.push(action);
    });
    for (const command of [commands.primary, ...(commands.secondary ?? []), commands.danger]) {
      command?.onSelect();
    }

    for (const item of commands.menu ?? []) {
      item.onSelect();
    }

    expect(invoked).toEqual(['logs', 'shell', 'delete', 'forward-port', 'debug', 'events', 'copy-name']);
  });

  it('has a stub that does nothing yet and takes every action', () => {
    for (const action of ['logs', 'shell', 'delete', 'forward-port', 'debug', 'events', 'copy-name'] as const) {
      expect(notAvailableYet(action)).toBeUndefined();
    }
  });
});
