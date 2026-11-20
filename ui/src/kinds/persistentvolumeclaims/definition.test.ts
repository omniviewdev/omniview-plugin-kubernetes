import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { persistentVolumeClaimDefinition } from './definition';
import { persistentVolumeClaimRow, persistentVolumeClaimSearchText, type PersistentVolumeClaimRow } from './row';

// The PersistentVolumeClaim definition, as the mock's `PRINTER.PersistentVolumeClaim` has it (MOCK k8s-resource-definitions.js:829-833; ch17 K60.3): after the name, Status, Volume, Capacity, Storage class and
// Age. The wide set (Access modes, Volume mode, Requested) and the Columns chooser's wait for the list page to have them. A claim lives in a namespace, which is its second line under the name.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): PersistentVolumeClaimRow => persistentVolumeClaimRow(hostRecord(object, 'row:1', persistentVolumeClaimDefinition.type));
const claim = (extra: Record<string, unknown>, metadata: Record<string, unknown> = {}) =>
  row({ metadata: { name: 'data', namespace: 'storage', creationTimestamp: '2026-11-17T20:00:00Z', ...metadata }, ...extra });
const cell = (id: string, target: PersistentVolumeClaimRow) => persistentVolumeClaimDefinition.fields.find((field) => field.id === id)!.display(target, NOW);
const sortOf = (id: string, target: PersistentVolumeClaimRow) => persistentVolumeClaimDefinition.fields.find((field) => field.id === id)!.sortValue(target);

const GIB = 1024 ** 3;
const bound = claim({ spec: { volumeName: 'pv-data', storageClassName: 'standard' }, status: { phase: 'Bound', capacity: { storage: '1Gi' } } });
const pending = claim({ spec: { storageClassName: 'fast', resources: { requests: { storage: '1Gi' } } }, status: { phase: 'Pending' } });
const lost = claim({ spec: { volumeName: 'pv-lost' }, status: { phase: 'Lost' } });
const terminating = claim({ spec: { volumeName: 'pv-data' }, status: { phase: 'Bound' } }, { deletionTimestamp: '2026-11-19T19:00:00Z' });

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(persistentVolumeClaimDefinition).toMatchObject({
      type: 'k8s:/persistentvolumeclaims',
      identity: { group: '', version: 'v1', resource: 'persistentvolumeclaims' },
      kind: 'PersistentVolumeClaim',
      nouns: { one: 'PersistentVolumeClaim', other: 'PersistentVolumeClaims' },
      page: 'persistentvolumeclaims',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Status, Volume, Capacity, Storage class, Age', () => {
    expect(persistentVolumeClaimDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['status', 'Status', false],
      ['volume', 'Volume', false],
      ['capacity', 'Capacity', false],
      ['storageClass', 'Storage class', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: a size to the right, a width that holds the longest state word, `Terminating`, with its glyph (7.2 px a character plus 42)', () => {
    const by = Object.fromEntries(persistentVolumeClaimDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.status).toMatchObject({ fit: 'fixed', width: 121, align: 'left', sort: 'text' });
    expect(by.volume).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.capacity).toMatchObject({ fit: 'fixed', width: 75, align: 'right', sort: 'number' });
    expect(by.storageClass).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has one field per column, in the same order', () => {
    expect(persistentVolumeClaimDefinition.fields.map((field) => field.id)).toEqual(persistentVolumeClaimDefinition.columns.map((column) => column.id));
  });

  it('has the namespace under the name (null when the object has none), no tail to keep, and no detail page yet', () => {
    expect(persistentVolumeClaimDefinition.list.identity.second(bound)).toBe('storage');
    expect(persistentVolumeClaimDefinition.list.identity.second(row({ metadata: { name: 'x' } }))).toBeNull();
    expect(persistentVolumeClaimDefinition.list.identity.tail(bound)).toBe(0);
    expect(persistentVolumeClaimDefinition.detail).toBeUndefined();
    expect(persistentVolumeClaimDefinition.list.defaultSort).toEqual({ id: 'name', direction: 'asc' });
  });
});

describe('the quick filters: the three words of a claim, each a word', () => {
  const { quickFilters } = persistentVolumeClaimDefinition.list;
  const matching = (target: PersistentVolumeClaimRow) => quickFilters.filter((filter) => filter.test(target)).map((filter) => filter.id);

  it('has them in the mock\'s order, words and tones', () => {
    expect(quickFilters.map(({ id, label, tone }) => [id, label, tone])).toEqual([
      ['bound', 'Bound', 'success'],
      ['pending', 'Pending', 'warning'],
      ['lost', 'Lost', 'error'],
    ]);
  });

  it('files each word under its own filter', () => {
    expect(matching(bound)).toEqual(['bound']);
    expect(matching(pending)).toEqual(['pending']);
    expect(matching(lost)).toEqual(['lost']);
  });

  it('puts a Terminating claim, and one with no state, in no filter', () => {
    expect(matching(terminating)).toEqual([]);
    expect(matching(claim({}))).toEqual([]);
  });
});

describe('the row: the word, the volume, the capacity and the class', () => {
  it('reads the phase with its role, the volume, the capacity as a number of bytes and the class', () => {
    expect(bound).toMatchObject({
      name: 'data',
      namespace: 'storage',
      status: { word: 'Bound', role: 'healthy' },
      volume: 'pv-data',
      capacity: GIB,
      storageClass: 'standard',
    });
  });

  it('says Terminating for a claim that is marked for deletion, whatever its phase says: kubectl\'s `printPersistentVolumeClaim` does', () => {
    expect(terminating.status).toEqual({ word: 'Terminating', role: 'progress' });
  });

  it('says Pending and Lost with the roles of the table', () => {
    expect([pending.status, lost.status]).toEqual([
      { word: 'Pending', role: 'progress' },
      { word: 'Lost', role: 'error' },
    ]);
  });

  it('says a phase the table has no role for as it is written, and nothing for a claim that states none', () => {
    expect(claim({ status: { phase: 'Frozen' } }).status).toEqual({ word: 'Frozen', role: undefined });
    expect(claim({}).status).toBeUndefined();
    expect(claim({ status: {} }).status).toBeUndefined();
  });

  it('has no volume for an absent or an empty name', () => {
    expect(pending.volume).toBeUndefined();
    expect(claim({ spec: { volumeName: '' } }).volume).toBeUndefined();
  });

  it('reads the capacity from the status, never from the request: a claim that is not bound has none yet', () => {
    expect(pending.capacity).toBeUndefined();
    expect(lost.capacity).toBeUndefined();
    expect(claim({ status: { capacity: {} } }).capacity).toBeUndefined();
    expect(claim({ status: { capacity: { storage: 'lots' } } }).capacity).toBeUndefined();
    expect(claim({ status: { capacity: { storage: '1536Mi' } } }).capacity).toBe(1536 * 1024 ** 2);
  });

  it('has no storage class for an absent or an empty one: a claim may ask for none on purpose', () => {
    expect(claim({ spec: {} }).storageClass).toBeUndefined();
    expect(claim({ spec: { storageClassName: '' } }).storageClass).toBeUndefined();
  });

  it('says nothing for a body that is not an object: dashes, never a made-up value', () => {
    expect(row('not an object')).toMatchObject({ name: '', namespace: '', status: undefined, volume: undefined, capacity: undefined, storageClass: undefined, createdAt: undefined });
    expect(row(null)).toMatchObject({ status: undefined, capacity: undefined });
  });

  it('searches the name, the namespace, the word, the volume and the class', () => {
    const text = persistentVolumeClaimSearchText(bound);
    expect(text).toContain('data');
    expect(text).toContain('storage');
    expect(text).toContain('bound');
    expect(text).toContain('pv-data');
    expect(text).toContain('standard');
  });
});

describe('the cells', () => {
  it('draws the word with its role, the volume, the capacity in the mock\'s units, the class and the age', () => {
    expect(cell('status', bound)).toEqual({ kind: 'status', raw: 'Bound', label: 'Bound', role: 'healthy' });
    expect(cell('status', terminating)).toEqual({ kind: 'status', raw: 'Terminating', label: 'Terminating', role: 'progress' });
    expect(cell('volume', bound)).toEqual({ kind: 'text', text: 'pv-data' });
    expect(cell('capacity', bound)).toEqual({ kind: 'text', text: '1 GiB' });
    expect(cell('capacity', claim({ status: { capacity: { storage: '1536Mi' } } }))).toEqual({ kind: 'text', text: '1.5 GiB' });
    expect(cell('storageClass', bound)).toEqual({ kind: 'text', text: 'standard' });
    expect(cell('age', bound)).toMatchObject({ kind: 'age', text: '2d' });
  });

  it('draws a dash that says why where the object states nothing, and for a Lost claim that never had a capacity: the object states none, and kubectl\'s `0` is the zero Quantity', () => {
    const bare = claim({});
    expect(cell('status', bare)).toEqual({ kind: 'none', reason: 'The claim reports no phase yet.' });
    expect(cell('volume', pending)).toEqual({ kind: 'none', reason: 'The claim is not bound to a volume.' });
    expect(cell('capacity', lost)).toEqual({ kind: 'none', reason: 'The claim has no capacity yet.' });
    expect(cell('storageClass', bare)).toEqual({ kind: 'none', reason: 'The claim names no storage class.' });
    expect(cell('age', row({}))).toEqual({ kind: 'none', reason: 'The PersistentVolumeClaim has no creation time.' });
  });

  it('sorts by the word, the volume, the bytes, the class and the age', () => {
    expect([sortOf('name', bound), sortOf('status', bound), sortOf('volume', bound), sortOf('capacity', bound), sortOf('storageClass', bound)]).toEqual(['data', 'Bound', 'pv-data', GIB, 'standard']);
    expect(sortOf('age', bound)).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
    expect([sortOf('status', claim({})), sortOf('volume', pending), sortOf('capacity', pending), sortOf('storageClass', claim({}))]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
