import { describe, expect, it } from 'vitest';

import type { KindCommands } from '../definition';

import { reasonOf, unavailableCommands } from './commands';

// The commands of an object's header, as the mock lays them out for the kind (MOCK k8s-resource.js `LAYOUT`; K59), offered with the kit's pattern for a command that cannot be used yet. None of them has
// a backend behind it from the new UI: each stays where the design puts it, keeps its focus, does nothing, and says why once, in the identity line.

const DEPLOYMENT: KindCommands = {
  primary: { id: 'scale', label: 'Scale' },
  secondary: [{ id: 'restart', label: 'Restart' }, { id: 'logs', label: 'Logs' }],
  danger: { id: 'delete', label: 'Delete' },
  menu: [{ id: 'roll-back', label: 'Roll back…' }, { id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
};

describe('reasonOf: the one sentence the identity line says', () => {
  it('names every labelled command, in the order they are drawn', () => {
    expect(reasonOf(DEPLOYMENT)).toBe('Scale, Restart, Logs and Delete are not available yet');
  });

  it('names two with "and", and one with "is"', () => {
    expect(reasonOf({ primary: { id: 'logs', label: 'Logs' }, danger: { id: 'delete', label: 'Delete' } })).toBe('Logs and Delete are not available yet');
    expect(reasonOf({ danger: { id: 'delete', label: 'Delete' } })).toBe('Delete is not available yet');
  });

  it('does not name an item of the menu: the menu is not a labelled command', () => {
    expect(reasonOf({ menu: [{ id: 'events', label: 'Events' }] })).toBeUndefined();
  });

  it('is nothing for a kind that has no labelled command, and for none given', () => {
    expect(reasonOf({})).toBeUndefined();
    expect(reasonOf(undefined)).toBeUndefined();
  });
});

describe('unavailableCommands', () => {
  const commands = unavailableCommands(DEPLOYMENT);

  it('has each labelled command in the one order the design allows, each with the reason and none with an action to take', () => {
    const reason = 'Scale, Restart, Logs and Delete are not available yet';
    expect(commands?.primary).toMatchObject({ id: 'scale', label: 'Scale', disabledReason: reason });
    expect(commands?.secondary?.map((command) => [command.id, command.label, command.disabledReason])).toEqual([['restart', 'Restart', reason], ['logs', 'Logs', reason]]);
    expect(commands?.danger).toMatchObject({ id: 'delete', label: 'Delete', disabledReason: reason });
  });

  it('has each item of the menu, disabled', () => {
    expect(commands?.menu?.map((item) => [item.id, item.label, item.disabled])).toEqual([['roll-back', 'Roll back…', true], ['events', 'Events', true], ['copy-name', 'Copy name', true]]);
  });

  it('never calls anything when a command is chosen: there is no action behind it', () => {
    expect(() => {
      commands?.primary?.onSelect();
      commands?.secondary?.forEach((command) => {
        command.onSelect();
      });
      commands?.danger?.onSelect();
      commands?.menu?.forEach((item) => {
        item.onSelect();
      });
    }).not.toThrow();
  });

  it('has no member for a command the kind does not lay out', () => {
    expect(unavailableCommands({ danger: { id: 'delete', label: 'Delete' } })).toEqual({
      danger: expect.objectContaining({ id: 'delete' }),
    });
    expect(unavailableCommands(undefined)).toBeUndefined();
    expect(unavailableCommands({})).toBeUndefined();
  });
});
