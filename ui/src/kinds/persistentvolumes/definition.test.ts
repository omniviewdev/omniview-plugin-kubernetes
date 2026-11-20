import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { persistentVolumeDefinition } from './definition';
import { persistentVolumeRow, persistentVolumeSearchText, type PersistentVolumeRow } from './row';

// The PersistentVolume definition, as the mock's `PRINTER.PersistentVolume` has it (MOCK k8s-resource-definitions.js:824-828; ch17 K60.3): after the name, Capacity, Status, Claim, Storage class and Age. The
// wide set (Access modes, Reclaim policy, Reason) and the Columns chooser's wait for the list page to have them. A PersistentVolume lives in no namespace: it has no second line under its name.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): PersistentVolumeRow => persistentVolumeRow(hostRecord(object, 'row:1', persistentVolumeDefinition.type));
const volume = (extra: Record<string, unknown>, metadata: Record<string, unknown> = {}) =>
  row({ metadata: { name: 'pv-data', creationTimestamp: '2026-11-17T20:00:00Z', ...metadata }, ...extra });
const cell = (id: string, target: PersistentVolumeRow) => persistentVolumeDefinition.fields.find((field) => field.id === id)!.display(target, NOW);
const sortOf = (id: string, target: PersistentVolumeRow) => persistentVolumeDefinition.fields.find((field) => field.id === id)!.sortValue(target);

const GIB = 1024 ** 3;
const bound = volume({
  spec: { capacity: { storage: '1Gi' }, claimRef: { namespace: 'storage', name: 'data' }, storageClassName: 'standard' },
  status: { phase: 'Bound' },
});
const available = volume({ spec: { capacity: { storage: '2Ti' } }, status: { phase: 'Available' } });
const released = volume({ status: { phase: 'Released' } });
const failed = volume({ status: { phase: 'Failed' } });
const terminating = volume({ status: { phase: 'Bound' } }, { deletionTimestamp: '2026-11-19T19:00:00Z' });

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(persistentVolumeDefinition).toMatchObject({
      type: 'k8s:/persistentvolumes',
      identity: { group: '', version: 'v1', resource: 'persistentvolumes' },
      kind: 'PersistentVolume',
      nouns: { one: 'PersistentVolume', other: 'PersistentVolumes' },
      page: 'persistentvolumes',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Capacity, Status, Claim, Storage class, Age', () => {
    expect(persistentVolumeDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['capacity', 'Capacity', false],
      ['status', 'Status', false],
      ['claim', 'Claim', false],
      ['storageClass', 'Storage class', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: a size to the right, a width that holds the longest state word, `Terminating`, with its glyph (7.2 px a character plus 42)', () => {
    const by = Object.fromEntries(persistentVolumeDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.capacity).toMatchObject({ fit: 'fixed', width: 75, align: 'right', sort: 'number' });
    expect(by.status).toMatchObject({ fit: 'fixed', width: 121, align: 'left', sort: 'text' });
    expect(by.claim).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.storageClass).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has one field per column, in the same order', () => {
    expect(persistentVolumeDefinition.fields.map((field) => field.id)).toEqual(persistentVolumeDefinition.columns.map((column) => column.id));
  });

  it('has no second line under the name (it lives in no namespace), no tail to keep, and no detail page yet', () => {
    expect(persistentVolumeDefinition.list.identity.second(bound)).toBeNull();
    expect(persistentVolumeDefinition.list.identity.tail(bound)).toBe(0);
    expect(persistentVolumeDefinition.detail).toBeUndefined();
    expect(persistentVolumeDefinition.list.defaultSort).toEqual({ id: 'name', direction: 'asc' });
  });
});

describe('the quick filters: four words of a volume, each a word', () => {
  const { quickFilters } = persistentVolumeDefinition.list;
  const matching = (target: PersistentVolumeRow) => quickFilters.filter((filter) => filter.test(target)).map((filter) => filter.id);

  it('has them in the mock\'s order, words and tones', () => {
    expect(quickFilters.map(({ id, label, tone }) => [id, label, tone])).toEqual([
      ['available', 'Available', 'success'],
      ['bound', 'Bound', 'success'],
      ['released', 'Released', 'warning'],
      ['failed', 'Failed', 'error'],
    ]);
  });

  it('files each word under its own filter', () => {
    expect(matching(available)).toEqual(['available']);
    expect(matching(bound)).toEqual(['bound']);
    expect(matching(released)).toEqual(['released']);
    expect(matching(failed)).toEqual(['failed']);
  });

  it('puts a Pending or a Terminating volume, and one with no state, in no filter (the mock has the same four)', () => {
    expect(matching(volume({ status: { phase: 'Pending' } }))).toEqual([]);
    expect(matching(terminating)).toEqual([]);
    expect(matching(volume({}))).toEqual([]);
  });
});

describe('the row: capacity, the word, the claim and the class', () => {
  it('reads the capacity as a number of bytes, the claim as namespace/name, the class and the phase with its role', () => {
    expect(bound).toMatchObject({
      name: 'pv-data',
      namespace: '',
      capacity: GIB,
      status: { word: 'Bound', role: 'healthy' },
      claim: 'storage/data',
      storageClass: 'standard',
    });
  });

  it('reads every quantity form the API gives: binary and decimal suffixes, and a plain number of bytes', () => {
    const capacity = (storage: string) => volume({ spec: { capacity: { storage } } }).capacity;
    expect([capacity('1536Mi'), capacity('500Mi'), capacity('2Ti'), capacity('10M'), capacity('4096')]).toEqual([1536 * 1024 ** 2, 500 * 1024 ** 2, 2 * 1024 ** 4, 1e7, 4096]);
  });

  it('says Terminating for a volume that is marked for deletion, whatever its phase says: kubectl\'s `printPersistentVolume` does, and the cluster is the reference (the mock reads the phase alone)', () => {
    expect(terminating.status).toEqual({ word: 'Terminating', role: 'progress' });
  });

  it('says Available, Released and Failed with the roles of the table', () => {
    expect([available, released, failed].map((target) => target.status)).toEqual([
      { word: 'Available', role: 'healthy' },
      { word: 'Released', role: 'attention' },
      { word: 'Failed', role: 'error' },
    ]);
  });

  it('says a phase the table has no role for as it is written, and nothing for a volume that states none', () => {
    expect(volume({ status: { phase: 'Frozen' } }).status).toEqual({ word: 'Frozen', role: undefined });
    expect(volume({}).status).toBeUndefined();
    expect(volume({ status: {} }).status).toBeUndefined();
  });

  it('has no capacity when the object states none or states what is not a quantity', () => {
    expect(volume({}).capacity).toBeUndefined();
    expect(volume({ spec: {} }).capacity).toBeUndefined();
    expect(volume({ spec: { capacity: {} } }).capacity).toBeUndefined();
    expect(volume({ spec: { capacity: { storage: 'lots' } } }).capacity).toBeUndefined();
    expect(volume({ spec: { capacity: { storage: 5 } } }).capacity).toBeUndefined();
    expect(volume({ spec: { capacity: 'big' } }).capacity).toBeUndefined();
  });

  it('has no claim without a claimRef, and the mock\'s `?` for what the reference leaves out', () => {
    expect(volume({ spec: {} }).claim).toBeUndefined();
    expect(volume({ spec: { claimRef: 'data' } }).claim).toBeUndefined();
    expect(volume({ spec: { claimRef: { name: 'data' } } }).claim).toBe('?/data');
    expect(volume({ spec: { claimRef: { namespace: '', name: 'data' } } }).claim).toBe('?/data');
    expect(volume({ spec: { claimRef: { namespace: 'storage' } } }).claim).toBe('storage/?');
  });

  it('has no storage class for an absent or an empty one: a volume may name none on purpose', () => {
    expect(volume({ spec: {} }).storageClass).toBeUndefined();
    expect(volume({ spec: { storageClassName: '' } }).storageClass).toBeUndefined();
    expect(volume({ spec: { storageClassName: 'manual' } }).storageClass).toBe('manual');
  });

  it('does not read the legacy storage-class annotation, which kubectl falls back to and the mock does not', () => {
    expect(volume({ spec: {} }, { annotations: { 'volume.beta.kubernetes.io/storage-class': 'old' } }).storageClass).toBeUndefined();
  });

  it('says nothing for a body that is not an object: dashes, never a made-up value', () => {
    expect(row('not an object')).toMatchObject({ name: '', capacity: undefined, status: undefined, claim: undefined, storageClass: undefined, createdAt: undefined });
    expect(row(null)).toMatchObject({ capacity: undefined, status: undefined });
  });

  it('searches the name, the word, the claim and the class', () => {
    const text = persistentVolumeSearchText(bound);
    expect(text).toContain('pv-data');
    expect(text).toContain('bound');
    expect(text).toContain('storage/data');
    expect(text).toContain('standard');
  });
});

describe('the cells', () => {
  it('draws the capacity in the mock\'s units, the word with its role, the claim, the class and the age', () => {
    expect(cell('capacity', bound)).toEqual({ kind: 'text', text: '1 GiB' });
    expect(cell('capacity', available)).toEqual({ kind: 'text', text: '2 TiB' });
    expect(cell('capacity', volume({ spec: { capacity: { storage: '1536Mi' } } }))).toEqual({ kind: 'text', text: '1.5 GiB' });
    expect(cell('capacity', volume({ spec: { capacity: { storage: '500Mi' } } }))).toEqual({ kind: 'text', text: '500 MiB' });
    expect(cell('capacity', volume({ spec: { capacity: { storage: '10Mi' } } }))).toEqual({ kind: 'text', text: '10 MiB' });
    expect(cell('status', bound)).toEqual({ kind: 'status', raw: 'Bound', label: 'Bound', role: 'healthy' });
    expect(cell('status', terminating)).toEqual({ kind: 'status', raw: 'Terminating', label: 'Terminating', role: 'progress' });
    expect(cell('claim', bound)).toEqual({ kind: 'text', text: 'storage/data' });
    expect(cell('storageClass', bound)).toEqual({ kind: 'text', text: 'standard' });
    expect(cell('age', bound)).toMatchObject({ kind: 'age', text: '2d' });
  });

  it('draws a dash that says why where the object states nothing', () => {
    const bare = volume({});
    expect(cell('capacity', bare)).toEqual({ kind: 'none', reason: 'The PersistentVolume states no capacity.' });
    expect(cell('status', bare)).toEqual({ kind: 'none', reason: 'The PersistentVolume reports no phase yet.' });
    expect(cell('claim', bare)).toEqual({ kind: 'none', reason: 'The volume is not claimed.' });
    expect(cell('storageClass', bare)).toEqual({ kind: 'none', reason: 'The volume names no storage class.' });
    expect(cell('age', row({}))).toEqual({ kind: 'none', reason: 'The PersistentVolume has no creation time.' });
  });

  it('sorts by the bytes, the word, the claim, the class and the age', () => {
    expect([sortOf('name', bound), sortOf('capacity', bound), sortOf('status', bound), sortOf('claim', bound), sortOf('storageClass', bound)]).toEqual([
      'pv-data',
      GIB,
      'Bound',
      'storage/data',
      'standard',
    ]);
    expect(sortOf('age', bound)).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
    expect([sortOf('capacity', volume({})), sortOf('status', volume({})), sortOf('claim', volume({})), sortOf('storageClass', volume({}))]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
