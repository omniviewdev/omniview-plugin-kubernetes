import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { serviceAccountDefinition } from './definition';
import { serviceAccountRow, serviceAccountSearchText, type ServiceAccountRow } from './row';

// The ServiceAccount definition, as the mock's `PRINTER.ServiceAccount` has it (MOCK k8s-resource-definitions.js:845; ch17 K60.1 and K60.3): kubectl prints a name and an age only, so the list gets the
// next most useful column, Secrets (the mock's `secretCount`, which reads zero for an object without `secrets`), after the name, and Age. The mock has no quick filters for it.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): ServiceAccountRow => serviceAccountRow(hostRecord(object, 'row:1', serviceAccountDefinition.type));
const account = (extra: Record<string, unknown>) => row({ metadata: { name: 'builder', namespace: 'access', creationTimestamp: '2026-11-17T20:00:00Z' }, ...extra });
const cell = (id: string, target: ServiceAccountRow) => serviceAccountDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(serviceAccountDefinition).toMatchObject({
      type: 'k8s:/serviceaccounts',
      identity: { group: '', version: 'v1', resource: 'serviceaccounts' },
      kind: 'ServiceAccount',
      nouns: { one: 'ServiceAccount', other: 'ServiceAccounts' },
      page: 'serviceaccounts',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Secrets, Age', () => {
    expect(serviceAccountDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['secrets', 'Secrets', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: the count to the right', () => {
    const by = Object.fromEntries(serviceAccountDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.secrets).toMatchObject({ fit: 'fixed', width: 67, align: 'right', sort: 'number' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has one field for each column, in the same order', () => {
    expect(serviceAccountDefinition.fields.map((field) => field.id)).toEqual(serviceAccountDefinition.columns.map((column) => column.id));
  });

  it('has no quick filters, no detail page yet, and no tail to keep on a name that was not generated', () => {
    expect(serviceAccountDefinition.list.quickFilters).toEqual([]);
    expect(serviceAccountDefinition.detail).toBeUndefined();
    expect(serviceAccountDefinition.list.identity.tail(account({}))).toBe(0);
  });

  it('sorts by name, first, and puts the namespace under it', () => {
    expect(serviceAccountDefinition.list.defaultSort).toEqual({ id: 'name', direction: 'asc' });
    expect(serviceAccountDefinition.list.identity.second(account({}))).toBe('access');
    expect(serviceAccountDefinition.list.identity.second(row({ metadata: { name: 'odd' } }))).toBeNull();
  });
});

describe('the row: how many Secrets the account lists', () => {
  it('counts the entries of secrets, and nothing of their names', () => {
    expect(account({ secrets: [{ name: 'legacy-token-abc' }, { name: 'legacy-token-def' }] })).toMatchObject({ name: 'builder', namespace: 'access', secrets: 2 });
  });

  it('counts an entry that is not an object too: the list is what the API holds, only its length is read', () => {
    expect(account({ secrets: [{ name: 'a' }, 'b', null] }).secrets).toBe(3);
  });

  it('is zero for an object without secrets: the API omits an empty list', () => {
    expect(account({}).secrets).toBe(0);
    expect(account({ secrets: [] }).secrets).toBe(0);
    expect(account({ secrets: null }).secrets).toBe(0);
  });

  it('says nothing for secrets that are not a list: a dash, never a zero made up', () => {
    expect(account({ secrets: 'legacy' }).secrets).toBeUndefined();
    expect(account({ secrets: { name: 'legacy' } }).secrets).toBeUndefined();
  });

  it('says nothing of the secrets for a body that is not an object', () => {
    for (const body of ['not an object', null, 7, ['a']]) {
      expect(row(body), JSON.stringify(body)).toMatchObject({ name: '', namespace: '', secrets: undefined, createdAt: undefined });
    }
  });

  it('keeps the time the object was created, and none when the timestamp is not a time', () => {
    expect(account({}).createdAt).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
    expect(row({ metadata: { name: 'x', creationTimestamp: 'yesterday' } }).createdAt).toBeUndefined();
  });

  it('searches the name and the namespace', () => {
    const text = serviceAccountSearchText(account({}));
    expect(text).toContain('builder');
    expect(text).toContain('access');
  });
});

describe('the cells', () => {
  it('draws the number of secrets in the code face, zero included', () => {
    expect(cell('secrets', account({ secrets: [{ name: 'a' }, { name: 'b' }] }))).toEqual({ kind: 'text', text: '2', mono: true });
    expect(cell('secrets', account({}))).toEqual({ kind: 'text', text: '0', mono: true });
  });

  it('draws a dash that says why for secrets that could not be read', () => {
    expect(cell('secrets', account({ secrets: 'legacy' }))).toEqual({ kind: 'none', reason: 'The ServiceAccount\'s secrets could not be read.' });
    expect(cell('secrets', row('not an object')).kind).toBe('none');
  });

  it('draws the name as plain text', () => {
    expect(cell('name', account({}))).toEqual({ kind: 'text', text: 'builder' });
  });

  it('draws the age in one unit, with the time in the tip, and a dash that says why for an object with no creation time', () => {
    expect(cell('age', account({}))).toEqual({ kind: 'age', createdAt: Date.UTC(2026, 10, 17, 20, 0, 0), text: '2d', long: '2026-11-17 20:00 UTC · 2 days ago' });
    expect(cell('age', row({ metadata: { name: 'x' } }))).toEqual({ kind: 'none', reason: 'The ServiceAccount has no creation time.' });
  });

  it('sorts by the number of secrets, with the missing one last', () => {
    const sortOf = (target: ServiceAccountRow) => serviceAccountDefinition.fields.find((field) => field.id === 'secrets')!.sortValue(target);
    expect([sortOf(account({ secrets: [{ name: 'a' }] })), sortOf(account({})), sortOf(account({ secrets: 1 }))]).toEqual([1, 0, undefined]);
  });
});
