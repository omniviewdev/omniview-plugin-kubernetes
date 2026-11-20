import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { replicaSetDefinition } from './definition';
import { replicaSetRow, replicaSetSearchText, type ReplicaSetRow } from './row';

// The ReplicaSet definition, as the mock's `PRINTER.ReplicaSet` has it (MOCK k8s-resource-definitions.js:754-757; ch17 K60.3): after the name, Status, Desired, Current, Ready and Age. The mock has no
// quick filters for it. The wide set (Images) and the Columns chooser's (Containers, Owner, ...) wait for the list page to have them. A ReplicaSet's name is generated (a Deployment's template hash).

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown, key = 'row:1'): ReplicaSetRow => replicaSetRow(hostRecord(object, key, replicaSetDefinition.type));
const replicaSet = (spec: Record<string, unknown>, status: Record<string, unknown> | undefined, name = 'cart-api-86bf766589') =>
  row({ metadata: { name, namespace: 'checkout', creationTimestamp: '2026-11-17T20:00:00Z' }, spec, ...(status === undefined ? {} : { status }) });

const well = replicaSet({ replicas: 3 }, { replicas: 3, readyReplicas: 3, availableReplicas: 3 });
const cell = (id: string, target: ReplicaSetRow = well) => replicaSetDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(replicaSetDefinition).toMatchObject({
      type: 'k8s:apps/replicasets',
      identity: { group: 'apps', version: 'v1', resource: 'replicasets' },
      kind: 'ReplicaSet',
      nouns: { one: 'ReplicaSet', other: 'ReplicaSets' },
      page: 'replicasets',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Status, Desired, Current, Ready, Age', () => {
    expect(replicaSetDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['status', 'Status', false],
      ['desired', 'Desired', false],
      ['current', 'Current', false],
      ['ready', 'Ready', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: counts to the right, a width that holds the longest state word of the rule', () => {
    const by = Object.fromEntries(replicaSetDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.status).toMatchObject({ fit: 'fixed', width: 150, align: 'left', sort: 'text' });
    expect(by.desired).toMatchObject({ fit: 'fixed', width: 68, align: 'right', sort: 'number' });
    expect(by.current).toMatchObject({ fit: 'fixed', width: 67, align: 'right', sort: 'number' });
    expect(by.ready).toMatchObject({ fit: 'fixed', width: 59, align: 'right', sort: 'number' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('keeps the end of a generated name whole: a Deployment\'s template hash, the mock\'s `cart-api-mqw97wkcj`', () => {
    expect(replicaSetDefinition.list.identity.tail(well)).toBe('-86bf766589'.length);
  });

  it('has no quick filters (the mock\'s definition has none: a strip is for a kind with a state field and a `quick` of its own) and no detail page yet', () => {
    expect(replicaSetDefinition.list.quickFilters).toEqual([]);
    expect(replicaSetDefinition.detail).toBeUndefined();
  });
});

describe('the row: the counts the object states, and the word of the rule over them', () => {
  it('reads Desired from the spec and Current and Ready from the status', () => {
    expect(well).toMatchObject({ name: 'cart-api-86bf766589', namespace: 'checkout', desired: 3, current: 3, ready: 3, status: { word: 'Ready', role: 'healthy' } });
  });

  it('reads a count the status leaves out as the API\'s zero: the API omits a count that is zero, and kubectl prints 0', () => {
    const none = replicaSet({ replicas: 1 }, { replicas: 1 }, 'bad-image');
    expect(none).toMatchObject({ desired: 1, current: 1, ready: 0, status: { word: 'Unavailable', role: 'error' } });
  });

  it('says Partially ready when fewer are ready than wanted, and Scaled to zero when none is wanted', () => {
    expect(replicaSet({ replicas: 2 }, { replicas: 2, readyReplicas: 1, availableReplicas: 1 }).status).toEqual({ word: 'Partially ready', role: 'attention' });
    expect(replicaSet({ replicas: 0 }, { replicas: 0 }).status).toEqual({ word: 'Scaled to zero', role: 'stopped' });
  });

  it('says Unavailable for replicas that are ready and not yet available (minReadySeconds): the API\'s zero, as for a Deployment (K2a ruling, A19)', () => {
    expect(replicaSet({ replicas: 2 }, { replicas: 2, readyReplicas: 2 }).status?.word).toBe('Unavailable');
  });

  it('says nothing of the counts or the state for an object that states no replica count or has no status: dashes, and no word made up', () => {
    for (const target of [replicaSet({}, { replicas: 1 }), replicaSet({ replicas: 1 }, undefined)]) {
      expect(target).toMatchObject({ desired: undefined, current: undefined, ready: undefined, status: undefined });
    }
  });

  it('searches the name, the namespace and the word', () => {
    expect(replicaSetSearchText(well)).toContain('cart-api-86bf766589');
    expect(replicaSetSearchText(well)).toContain('checkout');
    expect(replicaSetSearchText(well)).toContain('ready');
  });
});

describe('the cells', () => {
  it('draws the word with its role, and the counts in the code face, grouped', () => {
    expect(cell('status')).toEqual({ kind: 'status', raw: 'Ready', label: 'Ready', role: 'healthy' });
    expect(cell('desired')).toEqual({ kind: 'text', text: '3', mono: true });
    expect(cell('current')).toEqual({ kind: 'text', text: '3', mono: true });
    expect(cell('ready')).toEqual({ kind: 'text', text: '3', mono: true });
  });

  it('draws a zero count as a count, and a dash that says why for a count the object does not state', () => {
    expect(cell('ready', replicaSet({ replicas: 1 }, { replicas: 1 }))).toEqual({ kind: 'text', text: '0', mono: true });
    const unstated = replicaSet({}, { replicas: 1 });
    for (const id of ['status', 'desired', 'current', 'ready']) {
      expect(cell(id, unstated)).toEqual({ kind: 'none', reason: 'The ReplicaSet states no replica count.' });
    }
  });

  it('draws the age of the ReplicaSet, and a dash for one with no creation time', () => {
    expect(cell('age')).toMatchObject({ kind: 'age', text: '2d' });
    expect(cell('age', { ...well, createdAt: undefined })).toEqual({ kind: 'none', reason: 'The ReplicaSet has no creation time.' });
  });

  it('sorts by the word, the counts and the age', () => {
    const sortOf = (id: string) => replicaSetDefinition.fields.find((field) => field.id === id)!.sortValue(well);
    expect(sortOf('name')).toBe('cart-api-86bf766589');
    expect(sortOf('status')).toBe('Ready');
    expect([sortOf('desired'), sortOf('current'), sortOf('ready')]).toEqual([3, 3, 3]);
    expect(sortOf('age')).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
  });
});
