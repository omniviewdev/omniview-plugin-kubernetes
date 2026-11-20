import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { podDisruptionBudgetDefinition } from './definition';
import { podDisruptionBudgetRow, podDisruptionBudgetSearchText, type PodDisruptionBudgetRow } from './row';

// The PodDisruptionBudget definition, as the mock's `PRINTER.PodDisruptionBudget` has it (MOCK k8s-resource-definitions.js:812; ch17 K60.3): after the name, Allowed disruptions and Age. The mock's wide set
// (Min available, Max unavailable: the columns it shows only while its box has room) and its Columns chooser (Healthy, Desired healthy, Expected Pods) wait for the list page to have them: the list contract
// has no wide set yet, so they are not drawn. The mock has no quick filters for the kind.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): PodDisruptionBudgetRow => podDisruptionBudgetRow(hostRecord(object, 'row:1', podDisruptionBudgetDefinition.type));
const budget = (extra: Record<string, unknown>) => row({ metadata: { name: 'web', namespace: 'shop', creationTimestamp: '2026-11-17T20:00:00Z' }, ...extra });
const cell = (id: string, target: PodDisruptionBudgetRow) => podDisruptionBudgetDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

const web = budget({
  spec: { minAvailable: 2, selector: { matchLabels: { app: 'web' } } },
  status: { observedGeneration: 1, disruptionsAllowed: 1, currentHealthy: 3, desiredHealthy: 2, expectedPods: 3 },
});

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(podDisruptionBudgetDefinition).toMatchObject({
      type: 'k8s:policy/poddisruptionbudgets',
      identity: { group: 'policy', version: 'v1', resource: 'poddisruptionbudgets' },
      kind: 'PodDisruptionBudget',
      nouns: { one: 'PodDisruptionBudget', other: 'PodDisruptionBudgets' },
      page: 'poddisruptionbudgets',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Allowed disruptions, Age', () => {
    expect(podDisruptionBudgetDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['allowed', 'Allowed disruptions', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: the number of disruptions is fixed, to the right, and sorts as a number', () => {
    const by = Object.fromEntries(podDisruptionBudgetDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.allowed).toMatchObject({ fit: 'fixed', width: 141, align: 'right', sort: 'number' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has no quick filters, no detail page yet, the namespace under the name, and no tail to keep on a name that was not generated', () => {
    expect(podDisruptionBudgetDefinition.list.quickFilters).toEqual([]);
    expect(podDisruptionBudgetDefinition.detail).toBeUndefined();
    expect(podDisruptionBudgetDefinition.list.identity.second(web)).toBe('shop');
    expect(podDisruptionBudgetDefinition.list.identity.second({ ...web, namespace: '' })).toBeNull();
    expect(podDisruptionBudgetDefinition.list.identity.tail(web)).toBe(0);
  });
});

describe('the row: the disruptions the status allows', () => {
  it('reads the number of disruptions the budget allows now', () => {
    expect(web).toMatchObject({ name: 'web', namespace: 'shop', allowed: 1 });
  });

  it('reads 0 where the status says 0: a budget that allows none is a reading, and the API always writes the number', () => {
    expect(budget({ status: { disruptionsAllowed: 0, currentHealthy: 1, desiredHealthy: 1, expectedPods: 1 } }).allowed).toBe(0);
  });

  it('says nothing for a budget with no status, a status that holds no number, a number that is not one, or a body that is not an object', () => {
    for (const target of [budget({}), budget({ status: {} }), budget({ status: { currentHealthy: 1 } }), budget({ status: { disruptionsAllowed: '1' } }), row('not an object')]) {
      expect(target.allowed).toBeUndefined();
    }
  });

  it('searches the name, the namespace and the number', () => {
    const text = podDisruptionBudgetSearchText(web);
    for (const part of ['web', 'shop', '1']) {
      expect(text).toContain(part);
    }
  });
});

describe('the cells', () => {
  it('draws the number in the code face, 0 included', () => {
    expect(cell('allowed', web)).toEqual({ kind: 'text', text: '1', mono: true });
    expect(cell('allowed', budget({ status: { disruptionsAllowed: 0 } }))).toEqual({ kind: 'text', text: '0', mono: true });
  });

  it('draws a dash that says why for a budget that has no status yet', () => {
    expect(cell('allowed', budget({}))).toEqual({ kind: 'none', reason: 'The budget has no status yet.' });
  });

  it('draws the age, and a dash that says why for an object that has no creation time', () => {
    expect(cell('age', web)).toMatchObject({ kind: 'age', text: '2d' });
    expect(cell('age', row({ metadata: { name: 'web', namespace: 'shop' } }))).toEqual({ kind: 'none', reason: 'The PodDisruptionBudget has no creation time.' });
  });

  it('sorts by the number of disruptions and the age', () => {
    const sortOf = (id: string, target: PodDisruptionBudgetRow = web) => podDisruptionBudgetDefinition.fields.find((field) => field.id === id)!.sortValue(target);
    expect(sortOf('allowed')).toBe(1);
    expect(sortOf('allowed', budget({ status: { disruptionsAllowed: 0 } }))).toBe(0);
    expect(sortOf('allowed', budget({}))).toBeUndefined();
    expect(sortOf('age')).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
  });
});
