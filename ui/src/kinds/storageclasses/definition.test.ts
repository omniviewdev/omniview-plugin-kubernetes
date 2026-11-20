import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { storageClassDefinition } from './definition';
import { storageClassRow, storageClassSearchText, type StorageClassRow } from './row';

// The StorageClass definition, as the mock's `PRINTER.StorageClass` has it (MOCK k8s-resource-definitions.js:834-837; ch17 K60.3): after the name, Provisioner, Reclaim policy, Binding mode, Expansion and
// Age. The Columns chooser's (Default, Mount options) wait for the list page to have them. A StorageClass lives in no namespace and has no state, so it shows none, and the mock has no quick filters for it.
// Its fields are at the top of the object (it has no spec or status).

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): StorageClassRow => storageClassRow(hostRecord(object, 'row:1', storageClassDefinition.type));
const storageClass = (extra: Record<string, unknown>) => row({ metadata: { name: 'fast', creationTimestamp: '2026-11-17T20:00:00Z' }, ...extra });
const cell = (id: string, target: StorageClassRow) => storageClassDefinition.fields.find((field) => field.id === id)!.display(target, NOW);
const sortOf = (id: string, target: StorageClassRow) => storageClassDefinition.fields.find((field) => field.id === id)!.sortValue(target);

const full = storageClass({ provisioner: 'example.com/fast', reclaimPolicy: 'Retain', volumeBindingMode: 'WaitForFirstConsumer', allowVolumeExpansion: true });

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(storageClassDefinition).toMatchObject({
      type: 'k8s:storage.k8s.io/storageclasses',
      identity: { group: 'storage.k8s.io', version: 'v1', resource: 'storageclasses' },
      kind: 'StorageClass',
      nouns: { one: 'StorageClass', other: 'StorageClasses' },
      page: 'storageclasses',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Provisioner, Reclaim policy, Binding mode, Expansion, Age', () => {
    expect(storageClassDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['provisioner', 'Provisioner', false],
      ['reclaimPolicy', 'Reclaim policy', false],
      ['binding', 'Binding mode', false],
      ['expansion', 'Expansion', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock', () => {
    const by = Object.fromEntries(storageClassDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.provisioner).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.reclaimPolicy).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.binding).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.expansion).toMatchObject({ fit: 'fixed', width: 97, align: 'left', sort: 'text' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has one field per column, in the same order', () => {
    expect(storageClassDefinition.fields.map((field) => field.id)).toEqual(storageClassDefinition.columns.map((column) => column.id));
  });

  it('has no second line under the name (it lives in no namespace), no tail to keep, no quick filters and no detail page yet', () => {
    expect(storageClassDefinition.list.identity.second(full)).toBeNull();
    expect(storageClassDefinition.list.identity.tail(full)).toBe(0);
    expect(storageClassDefinition.list.quickFilters).toEqual([]);
    expect(storageClassDefinition.detail).toBeUndefined();
    expect(storageClassDefinition.list.defaultSort).toEqual({ id: 'name', direction: 'asc' });
  });
});

describe('the row: the provisioner, the two policies and whether the class expands', () => {
  it('reads the fields at the top of the object', () => {
    expect(full).toMatchObject({
      name: 'fast',
      namespace: '',
      provisioner: 'example.com/fast',
      reclaimPolicy: 'Retain',
      binding: 'WaitForFirstConsumer',
      expansion: true,
    });
  });

  it('says No for an object that states no allowVolumeExpansion: the API omits it when it is false (the mock\'s `falsy: true` reads it so), and kubectl prints false', () => {
    expect(storageClass({ provisioner: 'example.com/bare' }).expansion).toBe(false);
    expect(storageClass({ allowVolumeExpansion: false }).expansion).toBe(false);
  });

  it('says nothing for an allowVolumeExpansion that is not a boolean', () => {
    expect(storageClass({ allowVolumeExpansion: 'yes' }).expansion).toBeUndefined();
  });

  it('has nothing for the provisioner and the two policies when the object states none, or states an empty text', () => {
    expect(storageClass({})).toMatchObject({ provisioner: undefined, reclaimPolicy: undefined, binding: undefined });
    expect(storageClass({ provisioner: '', reclaimPolicy: '', volumeBindingMode: '' })).toMatchObject({ provisioner: undefined, reclaimPolicy: undefined, binding: undefined });
    expect(storageClass({ provisioner: 7, reclaimPolicy: [], volumeBindingMode: {} })).toMatchObject({ provisioner: undefined, reclaimPolicy: undefined, binding: undefined });
  });

  it('says nothing for a body that is not an object: dashes, never a No made up', () => {
    expect(row('not an object')).toMatchObject({ name: '', provisioner: undefined, reclaimPolicy: undefined, binding: undefined, expansion: undefined, createdAt: undefined });
    expect(row(null).expansion).toBeUndefined();
  });

  it('searches the name, the provisioner and the two policies', () => {
    const text = storageClassSearchText(full);
    expect(text).toContain('fast');
    expect(text).toContain('example.com/fast');
    expect(text).toContain('retain');
    expect(text).toContain('waitforfirstconsumer');
  });
});

describe('the cells', () => {
  it('draws the texts as they are, Yes for an expansion that is allowed, and the age', () => {
    expect(cell('provisioner', full)).toEqual({ kind: 'text', text: 'example.com/fast' });
    expect(cell('reclaimPolicy', full)).toEqual({ kind: 'text', text: 'Retain' });
    expect(cell('binding', full)).toEqual({ kind: 'text', text: 'WaitForFirstConsumer' });
    expect(cell('expansion', full)).toEqual({ kind: 'text', text: 'Yes' });
    expect(cell('age', full)).toMatchObject({ kind: 'age', text: '2d' });
  });

  it('draws No for an object that states no expansion', () => {
    expect(cell('expansion', storageClass({}))).toEqual({ kind: 'text', text: 'No' });
  });

  it('draws a dash that says why where the object states nothing', () => {
    const bare = storageClass({});
    expect(cell('provisioner', bare)).toEqual({ kind: 'none', reason: 'The StorageClass states no provisioner.' });
    expect(cell('reclaimPolicy', bare)).toEqual({ kind: 'none', reason: 'The StorageClass states no reclaim policy.' });
    expect(cell('binding', bare)).toEqual({ kind: 'none', reason: 'The StorageClass states no volume binding mode.' });
    expect(cell('expansion', row('not an object'))).toEqual({ kind: 'none', reason: 'The StorageClass cannot be read.' });
    expect(cell('age', row({}))).toEqual({ kind: 'none', reason: 'The StorageClass has no creation time.' });
  });

  it('sorts by the texts, by Yes and No as words, and by the age', () => {
    expect([sortOf('provisioner', full), sortOf('reclaimPolicy', full), sortOf('binding', full), sortOf('expansion', full)]).toEqual(['example.com/fast', 'Retain', 'WaitForFirstConsumer', 'Yes']);
    expect(sortOf('expansion', storageClass({}))).toBe('No');
    expect(sortOf('expansion', row('not an object'))).toBeUndefined();
    expect(sortOf('age', full)).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
    expect(sortOf('provisioner', storageClass({}))).toBeUndefined();
  });
});
