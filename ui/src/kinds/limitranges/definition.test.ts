import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { limitRangeDefinition } from './definition';
import { limitRangeRow, limitRangeSearchText, type LimitRangeRow } from './row';

// The LimitRange definition, as the mock's `PRINTER.LimitRange` has it (MOCK k8s-resource-definitions.js:807; ch17 K60.1 and K60.3): after the name, Items (the mock's `limitsCount`: the entries of `spec.limits`),
// Types (its `scopes`: the type of each entry) and Age. kubectl prints only a name and the time the object was made, so the mock names the first two itself. The mock has no quick filters for the kind, and no
// other column: what a Container may use is in its detail.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): LimitRangeRow => limitRangeRow(hostRecord(object, 'row:1', limitRangeDefinition.type));
const limitRange = (spec: Record<string, unknown> | undefined) =>
  row({ metadata: { name: 'defaults', namespace: 'checkout', creationTimestamp: '2026-11-17T20:00:00Z' }, ...(spec === undefined ? {} : { spec }) });
const cell = (id: string, target: LimitRangeRow) => limitRangeDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

/** One entry of `spec.limits`: the type it limits and a maximum, which the list does not read. */
const entry = (type?: string) => ({ ...(type === undefined ? {} : { type }), max: { cpu: '1' } });
const three = limitRange({ limits: [entry('Container'), entry('Pod'), entry('PersistentVolumeClaim')] });

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(limitRangeDefinition).toMatchObject({
      type: 'k8s:/limitranges',
      identity: { group: '', version: 'v1', resource: 'limitranges' },
      kind: 'LimitRange',
      nouns: { one: 'LimitRange', other: 'LimitRanges' },
      page: 'limitranges',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Items, Types, Age', () => {
    expect(limitRangeDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['items', 'Items', false],
      ['types', 'Types', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: the number of items is fixed and to the right, the types take what is left', () => {
    const by = Object.fromEntries(limitRangeDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.items).toMatchObject({ fit: 'fixed', width: 54, align: 'right', sort: 'number' });
    expect(by.types).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has no quick filters, no detail page yet, the namespace under the name, and no tail to keep on a name that was not generated', () => {
    expect(limitRangeDefinition.list.quickFilters).toEqual([]);
    expect(limitRangeDefinition.detail).toBeUndefined();
    expect(limitRangeDefinition.list.identity.second(three)).toBe('checkout');
    expect(limitRangeDefinition.list.identity.second({ ...three, namespace: '' })).toBeNull();
    expect(limitRangeDefinition.list.identity.tail(three)).toBe(0);
  });
});

describe('the row: the entries of spec.limits', () => {
  it('counts the entries and names the type of each, in order', () => {
    expect(three).toMatchObject({ name: 'defaults', namespace: 'checkout', items: 3, types: ['Container', 'Pod', 'PersistentVolumeClaim'] });
  });

  it('names each type once, in the order of its first entry: two entries of one type are two items and one type', () => {
    expect(limitRange({ limits: [entry('Container'), entry('Pod'), entry('Container')] })).toMatchObject({ items: 3, types: ['Container', 'Pod'] });
  });

  it('counts an entry that states no type, or an empty one, and names no type for it', () => {
    expect(limitRange({ limits: [entry(), entry(''), entry('Pod')] })).toMatchObject({ items: 3, types: ['Pod'] });
    expect(limitRange({ limits: [entry()] })).toMatchObject({ items: 1, types: undefined });
  });

  it('counts only the entries that are objects, as the API gives them', () => {
    expect(limitRange({ limits: [entry('Pod'), 'Container', 3, null] })).toMatchObject({ items: 1, types: ['Pod'] });
  });

  it('is zero items and no type for an empty list: the API holds the list, and it says there is nothing in it', () => {
    expect(limitRange({ limits: [] })).toMatchObject({ items: 0, types: undefined });
  });

  it('says nothing of the items or the types for an object that does not state `limits`, nor for a list that is not one, nor for a body that is not an object', () => {
    for (const target of [limitRange(undefined), limitRange({}), limitRange({ limits: 'Container' }), row('not an object')]) {
      expect(target).toMatchObject({ items: undefined, types: undefined });
    }
  });

  it('searches the name, the namespace, the number of items and the types', () => {
    const text = limitRangeSearchText(three);
    for (const part of ['defaults', 'checkout', '3', 'container', 'pod', 'persistentvolumeclaim']) {
      expect(text).toContain(part);
    }
  });
});

describe('the cells', () => {
  it('draws the number of items in the code face, and 0 for a list with none', () => {
    expect(cell('items', three)).toEqual({ kind: 'text', text: '3', mono: true });
    expect(cell('items', limitRange({ limits: [] }))).toEqual({ kind: 'text', text: '0', mono: true });
  });

  it('draws the types as they are written, up to three', () => {
    expect(cell('types', three)).toEqual({ kind: 'text', text: 'Container, Pod, PersistentVolumeClaim' });
    expect(cell('types', limitRange({ limits: [entry('Pod')] }))).toEqual({ kind: 'text', text: 'Pod' });
  });

  it('draws the first three types and the number of the rest, with every type in the tip', () => {
    const many = limitRange({ limits: [entry('Container'), entry('Pod'), entry('PersistentVolumeClaim'), entry('Image'), entry('Volume')] });
    expect(cell('types', many)).toEqual({ kind: 'text', text: 'Container, Pod, PersistentVolumeClaim +2', tip: 'Container, Pod, PersistentVolumeClaim, Image, Volume' });
  });

  it('draws a dash that says why for what the object does not state', () => {
    const bare = limitRange(undefined);
    expect(cell('items', bare)).toEqual({ kind: 'none', reason: 'The LimitRange states no limits.' });
    expect(cell('types', bare)).toEqual({ kind: 'none', reason: 'The LimitRange names no types.' });
    expect(cell('types', limitRange({ limits: [] }))).toEqual({ kind: 'none', reason: 'The LimitRange names no types.' });
  });

  it('draws the age, and a dash that says why for an object that has no creation time', () => {
    expect(cell('age', three)).toMatchObject({ kind: 'age', text: '2d' });
    expect(cell('age', row({ metadata: { name: 'defaults', namespace: 'checkout' } }))).toEqual({ kind: 'none', reason: 'The LimitRange has no creation time.' });
  });

  it('sorts by the number of items, the types and the age', () => {
    const sortOf = (id: string, target: LimitRangeRow = three) => limitRangeDefinition.fields.find((field) => field.id === id)!.sortValue(target);
    expect([sortOf('items'), sortOf('types')]).toEqual([3, 'Container, Pod, PersistentVolumeClaim']);
    expect(sortOf('items', limitRange({ limits: [] }))).toBe(0);
    expect(sortOf('items', limitRange(undefined))).toBeUndefined();
    expect(sortOf('age')).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
  });
});
