import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { statefulSetDefinition } from './definition';
import { statefulSetRow, type StatefulSetRow } from './row';

// The StatefulSet definition, as the mock's `PRINTER.StatefulSet` has it (MOCK k8s-resource-definitions.js:759-763; ch17 K60.3): Status, Ready, Service and Age after the name.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): StatefulSetRow => statefulSetRow(hostRecord(object, 'row:1', statefulSetDefinition.type));
const set = (spec: Record<string, unknown>, status: Record<string, unknown> | undefined) =>
  row({ metadata: { name: 'cart-cache', namespace: 'checkout', creationTimestamp: '2026-11-02T20:00:00Z' }, spec, ...(status === undefined ? {} : { status }) });

const well = set({ replicas: 2, serviceName: 'cart-cache' }, { replicas: 2, readyReplicas: 2, availableReplicas: 2, updatedReplicas: 2 });
const half = set({ replicas: 2, serviceName: 'cart-cache' }, { replicas: 2, readyReplicas: 1, availableReplicas: 1, updatedReplicas: 2 });
const cell = (id: string, target: StatefulSetRow = well) => statefulSetDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(statefulSetDefinition).toMatchObject({
      type: 'k8s:apps/statefulsets',
      identity: { group: 'apps', version: 'v1', resource: 'statefulsets' },
      kind: 'StatefulSet',
      nouns: { one: 'StatefulSet', other: 'StatefulSets' },
      page: 'statefulsets',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Status, Ready, Service, Age', () => {
    expect(statefulSetDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['status', 'Status', false],
      ['ready', 'Ready', false],
      ['service', 'Service', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: the Service is text that takes what is left', () => {
    const by = Object.fromEntries(statefulSetDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, required: true });
    expect(by.status).toMatchObject({ fit: 'fixed', width: 150, align: 'left', sort: 'text' });
    expect(by.ready).toMatchObject({ fit: 'fixed', width: 59, align: 'right', sort: 'ratio' });
    expect(by.service).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has a page of one StatefulSet, named by its namespace and its name (the list links to it)', () => {
    expect(statefulSetDefinition.detail).toMatchObject({ page: 'statefulset', identity: ['namespace', 'name'] });
  });
});

describe('the quick filters: the same four states as the other workloads', () => {
  const { quickFilters } = statefulSetDefinition.list;
  const matching = (target: StatefulSetRow) => quickFilters.filter((filter) => filter.test(target)).map((filter) => filter.id);

  it('has them in the mock\'s order, words and tones', () => {
    expect(quickFilters.map(({ id, label, tone }) => [id, label, tone])).toEqual([
      ['available', 'Available', 'success'],
      ['progressing', 'Progressing', 'info'],
      ['partial', 'Partially ready', 'warning'],
      ['unavailable', 'Unavailable', 'error'],
    ]);
  });

  it('files each state under its own filter, Progressing being a rollout under way: every one ready, fewer on the current revision', () => {
    expect(matching(well)).toEqual(['available']);
    expect(matching(set({ replicas: 2, serviceName: 's' }, { replicas: 2, readyReplicas: 2, availableReplicas: 2, updatedReplicas: 1 }))).toEqual(['progressing']);
    expect(matching(half)).toEqual(['partial']);
    expect(matching(set({ replicas: 1, serviceName: 's' }, { replicas: 1, availableReplicas: 0 }))).toEqual(['unavailable']);
    expect(matching(set({ replicas: 0, serviceName: 's' }, { replicas: 0, availableReplicas: 0 }))).toEqual([]);
  });
});

describe('the cells', () => {
  it('shows the name and the Service as text, and Ready as mono text, or as a state of its own below the wanted count', () => {
    expect(cell('name')).toEqual({ kind: 'text', text: 'cart-cache' });
    expect(cell('service')).toEqual({ kind: 'text', text: 'cart-cache' });
    expect(cell('ready')).toEqual({ kind: 'text', text: '2/2', mono: true });
    expect(cell('ready', half)).toEqual({ kind: 'status', raw: '1/2', label: '1/2', role: 'attention', tip: '1 of 2 ready' });
  });

  it('draws the state with its role', () => {
    expect(cell('status')).toEqual({ kind: 'status', raw: 'Available', label: 'Available', role: 'healthy' });
    expect(cell('status', half)).toEqual({ kind: 'status', raw: 'Partially ready', label: 'Partially ready', role: 'attention' });
  });

  it('shows a dash with its reason where the object states nothing, never an invented word (ch13 D7)', () => {
    const bare = row({ metadata: { name: 'x' } });

    for (const id of ['ready', 'status', 'service', 'age']) {
      expect(cell(id, bare).kind, id).toBe('none');
      expect(cell(id, bare), id).toMatchObject({ reason: expect.stringMatching(/\S/) as string });
    }
  });
});

describe('the row', () => {
  it('searches by the name, namespace, ready, state and Service, lower case', () => {
    const text = statefulSetDefinition.model.searchText(half);

    for (const part of ['cart-cache', 'checkout', '1/2', 'partially ready']) {
      expect(text).toContain(part);
    }
    expect(text).toBe(text.toLowerCase());
  });

  it('does not throw on a body that is not a StatefulSet', () => {
    for (const body of [{}, null, 'text', 7, [], { metadata: { name: 7 } }]) {
      expect(row(body)).toMatchObject({ name: '', namespace: '', ready: undefined, status: undefined, service: undefined });
    }
  });
});
