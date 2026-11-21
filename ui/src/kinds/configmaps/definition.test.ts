import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { configMapDefinition } from './definition';
import { configMapRow, configMapSearchText, type ConfigMapRow } from './row';

// The ConfigMap definition, as the mock's `PRINTER.ConfigMap` has it (MOCK k8s-resource-definitions.js:735-737; ch17 K60.1 and K60.3): the printer set is a name and an age, so it gets the next most useful
// columns, Keys, Key names and Size, and Age. Its values are plain text, so a list may read their size; the mock has no quick filters for it.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): ConfigMapRow => configMapRow(hostRecord(object, 'row:1', configMapDefinition.type));
const configMap = (extra: Record<string, unknown>) => row({ metadata: { name: 'app-settings', namespace: 'checkout', creationTimestamp: '2026-11-17T20:00:00Z' }, ...extra });
const cell = (id: string, target: ConfigMapRow) => configMapDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(configMapDefinition).toMatchObject({
      type: 'k8s:/configmaps',
      identity: { group: '', version: 'v1', resource: 'configmaps' },
      kind: 'ConfigMap',
      nouns: { one: 'ConfigMap', other: 'ConfigMaps' },
      page: 'configmaps',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Keys, Key names, Size, Age', () => {
    expect(configMapDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['keys', 'Keys', false],
      ['names', 'Key names', false],
      ['size', 'Size', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: numbers to the right, the key names take what is left', () => {
    const by = Object.fromEntries(configMapDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.keys).toMatchObject({ fit: 'fixed', width: 50, align: 'right', sort: 'number' });
    expect(by.names).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.size).toMatchObject({ fit: 'fixed', width: 58, align: 'right', sort: 'number' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has no quick filters, a detail page, and no tail to keep on a name that was not generated', () => {
    expect(configMapDefinition.list.quickFilters).toEqual([]);
    expect(configMapDefinition.detail).toMatchObject({ page: 'configmap', identity: ['namespace', 'name'] });
    expect(configMapDefinition.list.identity.tail(configMap({}))).toBe(0);
  });
});

describe('the row: the keys of data and binaryData, and the bytes of their values', () => {
  it('counts the keys of both, names them in order, and adds the bytes of the values: the text of data, and what a binaryData value decodes to', () => {
    const target = configMap({ data: { b: 'yyy', a: 'xx' }, binaryData: { c: 'AAECAwQFBgcICQ==' } });
    expect(target).toMatchObject({ name: 'app-settings', namespace: 'checkout', keys: 3, names: ['a', 'b', 'c'], size: 2 + 3 + 10 });
  });

  it('counts the bytes of a text, not its characters: two for é, three for €, four for an emoji', () => {
    expect(configMap({ data: { a: 'é', b: '€', c: '😀' } }).size).toBe(2 + 3 + 4);
  });

  it('counts the bytes of a binary value by its padding: a value with one = or two == is shorter than its base64 text says', () => {
    expect(configMap({ binaryData: { one: 'QQ==', two: 'QUI=', three: 'QUJD' } }).size).toBe(1 + 2 + 3);
  });

  it('is zero keys and zero bytes for a ConfigMap that holds none: the API omits an empty map, and kubectl prints 0', () => {
    expect(configMap({})).toMatchObject({ keys: 0, names: [], size: 0 });
  });

  it('says nothing of the keys for a body that is not an object: dashes, never a zero made up', () => {
    expect(row('not an object')).toMatchObject({ keys: undefined, names: undefined, size: undefined });
  });

  it('searches the name, the namespace and the key names', () => {
    const text = configMapSearchText(configMap({ data: { 'log-level': 'info' } }));
    expect(text).toContain('app-settings');
    expect(text).toContain('checkout');
    expect(text).toContain('log-level');
  });
});

describe('the cells', () => {
  const several = configMap({ data: { alpha: '1', bravo: '2', charlie: '3', delta: '4', echo: '5' } });
  const empty = configMap({});

  it('draws the number of keys in the code face', () => {
    expect(cell('keys', several)).toEqual({ kind: 'text', text: '5', mono: true });
    expect(cell('keys', empty)).toEqual({ kind: 'text', text: '0', mono: true });
  });

  it('draws the first three key names and the number of the rest, with every name in the tip', () => {
    expect(cell('names', several)).toEqual({ kind: 'text', text: 'alpha, bravo, charlie +2', tip: 'alpha, bravo, charlie, delta, echo' });
    expect(cell('names', configMap({ data: { a: '1', b: '2' } }))).toEqual({ kind: 'text', text: 'a, b' });
  });

  it('draws a dash that says why for no key names', () => {
    expect(cell('names', empty)).toEqual({ kind: 'none', reason: 'The ConfigMap holds no keys.' });
  });

  it('draws the size in the mock\'s units: bytes, then KiB', () => {
    expect(cell('size', configMap({ data: { a: 'xx' } }))).toEqual({ kind: 'text', text: '2 B' });
    expect(cell('size', configMap({ data: { a: 'x'.repeat(1337) } }))).toEqual({ kind: 'text', text: '1 KiB' });
    expect(cell('size', empty)).toEqual({ kind: 'text', text: '0 B' });
  });

  it('draws dashes for the keys and the size of a body that is not an object', () => {
    const odd = row('not an object');
    for (const id of ['keys', 'names', 'size']) {
      expect(cell(id, odd).kind, id).toBe('none');
    }
  });

  it('sorts by the number of keys, the names and the size', () => {
    const sortOf = (id: string) => configMapDefinition.fields.find((field) => field.id === id)!.sortValue(several);
    expect([sortOf('keys'), sortOf('names'), sortOf('size')]).toEqual([5, 'alpha, bravo, charlie, delta, echo', 5]);
  });
});
