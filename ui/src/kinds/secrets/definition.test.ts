import type { HostRecord, Value } from '@omniviewdev/runtime/ui/v1';
import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { secretDefinition } from './definition';
import { secretRow, secretSearchText, type SecretRow } from './row';

// The Secret definition, as the mock's `PRINTER.Secret` has it (MOCK k8s-resource-definitions.js:738; ch17 K60.3): after the name, Type, Keys and Age. What a Secret holds is never read and never shown:
// the list knows its name, its type and how many keys it has, and nothing of the keys' names or of what they hold (K21, the mock's contract: "Secret key names, values, stringData and full source NEVER
// become catalog projections").

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

/** Values that name themselves, so that a row or a text that holds one is found. */
const SENTINELS = { username: 'sentinel-username-4f1c', password: 'sentinel-password-9b7e', note: 'sentinel-note-2d8a' };

const metadata = { name: 'credentials', namespace: 'more', creationTimestamp: '2026-11-17T20:00:00Z' };
const secretOf = (object: unknown, key = 'row:1'): HostRecord => hostRecord(object, key, secretDefinition.type);
const row = (object: unknown): SecretRow => secretRow(secretOf(object));
const cell = (id: string, target: SecretRow) => secretDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

/** A map whose values throw when anything reads them: its keys can be counted and named, and nothing more is done to it. */
const untouchable = (keys: readonly string[]): Value => ({
  kind: 'map',
  value: Object.defineProperties(
    {},
    Object.fromEntries(
      keys.map((key) => [
        key,
        {
          enumerable: true,
          get: (): never => {
            throw new Error(`the value of ${key} was read`);
          },
        },
      ]),
    ),
  ),
});

/** The record of a TLS Secret whose `data` and whose annotations are untouchable. */
function guarded(): HostRecord {
  const base = secretOf({ metadata, type: 'kubernetes.io/tls' });
  const body = base.record.body;
  const meta = body.kind === 'map' ? body.value.metadata : undefined;
  if (body.kind !== 'map' || meta?.kind !== 'map') {
    throw new Error('the record of a Secret is a map with metadata');
  }

  const annotations = untouchable(['kubectl.kubernetes.io/last-applied-configuration']);
  const withAnnotations: Value = { kind: 'map', value: { ...meta.value, annotations } };
  return { ...base, record: { ...base.record, body: { kind: 'map', value: { ...body.value, metadata: withAnnotations, data: untouchable(['tls.crt', 'tls.key']) } } } };
}

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(secretDefinition).toMatchObject({
      type: 'k8s:/secrets',
      identity: { group: '', version: 'v1', resource: 'secrets' },
      kind: 'Secret',
      nouns: { one: 'Secret', other: 'Secrets' },
      page: 'secrets',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Type, Keys, Age', () => {
    expect(secretDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['type', 'Type', false],
      ['keys', 'Keys', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: the type takes what is left, the number of keys is to the right', () => {
    const by = Object.fromEntries(secretDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.type).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.keys).toMatchObject({ fit: 'fixed', width: 50, align: 'right', sort: 'number' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has no quick filters, no detail page yet, and no tail to keep on a name that was not generated', () => {
    expect(secretDefinition.list.quickFilters).toEqual([]);
    expect(secretDefinition.detail).toBeUndefined();
    expect(secretDefinition.list.identity.tail(row({ metadata }))).toBe(0);
  });
});

describe('the row: the type and the number of keys, and nothing a key holds', () => {
  const credentials = row({ metadata, type: 'Opaque', data: Object.fromEntries(Object.entries(SENTINELS).map(([key, value]) => [key, Buffer.from(value).toString('base64')])) });

  it('reads the type and counts the keys of data', () => {
    expect(credentials).toMatchObject({ name: 'credentials', namespace: 'more', type: 'Opaque', keys: 3 });
  });

  it('counts the keys of what the backend sends of a Secret: one entry for each key, holding its size in bytes and no value', () => {
    // pkg/plugin/resource/resourcers/projection.go: `data` is { <key>: { size } }, and the manifest annotation is left out.
    const projected = row({ metadata, type: 'Opaque', data: { username: { size: 20 }, password: { size: 24 }, note: { size: 0 } } });
    expect(projected).toMatchObject({ name: 'credentials', namespace: 'more', type: 'Opaque', keys: 3 });
    expect(`${JSON.stringify(projected)}\n${secretSearchText(projected)}`).not.toMatch(/username|password|note/);
  });

  it('holds no key name and no value: not in the row, and not in the text a search reads', () => {
    const everything = `${JSON.stringify(credentials)}\n${secretSearchText(credentials)}`;
    for (const value of Object.values(SENTINELS)) {
      expect(everything).not.toContain(value);
      expect(everything).not.toContain(Buffer.from(value).toString('base64'));
    }

    expect(everything).not.toMatch(/username|password|note/);
  });

  it('never reads a value or an annotation: a record whose values cannot be touched is listed all the same, and only the names of its keys were looked at', () => {
    // `last-applied-configuration` can hold the values whole, so an annotation is as untouchable as a value.
    expect(secretRow(guarded())).toMatchObject({ name: 'credentials', namespace: 'more', type: 'kubernetes.io/tls', keys: 2 });
  });

  it('is zero keys for a Secret that holds none: the API omits an empty map, and kubectl prints 0', () => {
    expect(row({ metadata, type: 'Opaque' })).toMatchObject({ type: 'Opaque', keys: 0 });
  });

  it('says nothing of the keys for a body that is not an object, and nothing of the type for a Secret that states none: dashes, never a zero or a word made up', () => {
    expect(row('not an object')).toMatchObject({ type: undefined, keys: undefined });
    expect(row({ metadata })).toMatchObject({ type: undefined, keys: 0 });
  });

  it('searches the name, the namespace and the type', () => {
    const text = secretSearchText(credentials);
    expect(text).toContain('credentials');
    expect(text).toContain('more');
    expect(text).toContain('opaque');
  });
});

describe('the cells', () => {
  const tls = row({ metadata, type: 'kubernetes.io/tls', data: { 'tls.crt': 'x', 'tls.key': 'y' } });

  it('draws the type as the platform spells it, and the number of keys in the code face', () => {
    expect(cell('type', tls)).toEqual({ kind: 'text', text: 'kubernetes.io/tls' });
    expect(cell('keys', tls)).toEqual({ kind: 'text', text: '2', mono: true });
    expect(cell('keys', row({ metadata, type: 'Opaque' }))).toEqual({ kind: 'text', text: '0', mono: true });
  });

  it('draws a dash that says why for what the object does not state', () => {
    const odd = row('not an object');
    expect(cell('type', odd)).toEqual({ kind: 'none', reason: 'The Secret states no type.' });
    expect(cell('keys', odd)).toEqual({ kind: 'none', reason: 'The Secret\'s keys could not be read.' });
  });

  it('sorts by the type, the number of keys and the age', () => {
    const sortOf = (id: string) => secretDefinition.fields.find((field) => field.id === id)!.sortValue(tls);
    expect([sortOf('type'), sortOf('keys')]).toEqual(['kubernetes.io/tls', 2]);
    expect(sortOf('age')).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
  });
});
