import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { ingressClassDefinition } from './definition';
import { ingressClassObject } from './object';
import { ingressClassRow, ingressClassSearchText, type IngressClassRow } from './row';

// The IngressClass definition, as the mock's `PRINTER.IngressClass` has it (MOCK k8s-resource-definitions.js:796; ch17 K60.3): after the name, Controller, Parameters and Age. The Columns chooser's Default (the
// annotation `ingressclass.kubernetes.io/is-default-class`) waits for the list page to have it, so it is not a column here. An IngressClass lives in no namespace, has no state word, and the mock has
// no quick filters for it.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): IngressClassRow => ingressClassRow(hostRecord(object, 'row:1', ingressClassDefinition.type));
const ingressClass = (spec: Record<string, unknown> | undefined, metadata: Record<string, unknown> = {}) =>
  row({ metadata: { name: 'external-lb', creationTimestamp: '2026-11-17T20:00:00Z', ...metadata }, ...(spec === undefined ? {} : { spec }) });
const cell = (id: string, target: IngressClassRow) => ingressClassDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

const parameters = { apiGroup: 'k8s.example.com', kind: 'IngressParameters', name: 'external-lb', scope: 'Cluster' };
const external = ingressClass({ controller: 'example.com/ingress-controller', parameters });
const plain = ingressClass({ controller: 'example.com/plain' });

describe('the definition', () => {
  it('names the type, the kind and the nouns: the plural of IngressClass is IngressClasses (KL1)', () => {
    expect(ingressClassDefinition).toMatchObject({
      type: 'k8s:networking.k8s.io/ingressclasses',
      identity: { group: 'networking.k8s.io', version: 'v1', resource: 'ingressclasses' },
      kind: 'IngressClass',
      nouns: { one: 'IngressClass', other: 'IngressClasses' },
      page: 'ingressclasses',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Controller, Parameters, Age', () => {
    expect(ingressClassDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['controller', 'Controller', false],
      ['parameters', 'Parameters', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: the controller and the parameters take what is left', () => {
    const by = Object.fromEntries(ingressClassDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    for (const id of ['controller', 'parameters']) {
      expect(by[id], id).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    }

    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has no second line under the name (it lives in no namespace), no tail to keep, no quick filters and no detail page yet', () => {
    expect(ingressClassDefinition.list.identity.second(external)).toBeNull();
    expect(ingressClassDefinition.list.identity.tail(external)).toBe(0);
    expect(ingressClassDefinition.list.quickFilters).toEqual([]);
    expect(ingressClassDefinition.detail).toBeUndefined();
  });
});

describe('the row: the controller and the parameters the spec states', () => {
  it('reads the controller, and the parameters as <kind>/<name>', () => {
    expect(external).toMatchObject({ name: 'external-lb', namespace: '', controller: 'example.com/ingress-controller', parameters: 'IngressParameters/external-lb' });
  });

  it('never says the API group of the parameters (K61.1): kubectl writes Kind.group/name, the mock Kind/name', () => {
    expect(ingressClass({ controller: 'c', parameters: { kind: 'IngressParameters', name: 'external-lb' } }).parameters).toBe('IngressParameters/external-lb');
    expect(external.parameters).not.toContain('k8s.example.com');
  });

  it('says neither the scope nor the Namespace of parameters that live in one: the kind and the name', () => {
    const scoped = ingressClass({ controller: 'c', parameters: { apiGroup: 'k8s.example.com', kind: 'IngressParameters', name: 'team-lb', scope: 'Namespace', namespace: 'checkout' } });
    expect(scoped.parameters).toBe('IngressParameters/team-lb');
  });

  it('says nothing of the parameters for a class that has none, or has parameters that name no kind or no name (the API requires both)', () => {
    expect(plain.parameters).toBeUndefined();
    for (const odd of [{}, { kind: 'IngressParameters' }, { name: 'external-lb' }, { kind: '', name: 'external-lb' }, { kind: 'IngressParameters', name: '' }, { kind: 7, name: 7 }, 'text', null, ['a']]) {
      expect(ingressClass({ controller: 'c', parameters: odd }).parameters, JSON.stringify(odd)).toBeUndefined();
    }
  });

  it('says nothing of the controller when it is absent, empty or not text, and nothing of either for an object that has no spec', () => {
    expect(ingressClass({}).controller).toBeUndefined();
    expect(ingressClass({ controller: '' }).controller).toBeUndefined();
    expect(ingressClass({ controller: 7 }).controller).toBeUndefined();
    expect(ingressClass(undefined)).toMatchObject({ controller: undefined, parameters: undefined });
  });

  it('does not read the default-class annotation: it is a column of the chooser, which the list does not have yet', () => {
    const marked = ingressClass({ controller: 'k8s.io/ingress-nginx' }, { annotations: { 'ingressclass.kubernetes.io/is-default-class': 'true' } });
    expect(marked).toEqual({ ...plain, controller: 'k8s.io/ingress-nginx' });
  });

  it('does not throw on a body that is not an IngressClass: an empty identity and nothing else', () => {
    for (const body of [{}, null, 'text', 7, [], { metadata: { name: 7 } }, { spec: 'text' }]) {
      expect(row(body), JSON.stringify(body)).toMatchObject({ name: '', namespace: '', nameTail: 0, controller: undefined, parameters: undefined, createdAt: undefined });
    }

    expect(ingressClassObject(hostRecord('text', 'row:x', ingressClassDefinition.type))).toEqual({});
  });

  it('searches the name, the controller and the parameters', () => {
    const text = ingressClassSearchText(external);
    for (const part of ['external-lb', 'example.com/ingress-controller', 'ingressparameters/external-lb']) {
      expect(text).toContain(part);
    }
  });
});

describe('the cells', () => {
  it('draws the controller and the parameters as plain text, and the age', () => {
    expect(cell('controller', external)).toEqual({ kind: 'text', text: 'example.com/ingress-controller' });
    expect(cell('parameters', external)).toEqual({ kind: 'text', text: 'IngressParameters/external-lb' });
    expect(cell('age', external)).toMatchObject({ kind: 'age', text: '2d' });
  });

  it('draws a dash that says why for what the class does not state, and for a body with no creation time', () => {
    expect(cell('parameters', plain)).toEqual({ kind: 'none', reason: 'The class has no parameters.' });
    expect(cell('controller', ingressClass(undefined))).toEqual({ kind: 'none', reason: 'The class names no controller.' });
    expect(cell('age', row({ metadata: { name: 'plain' } }))).toEqual({ kind: 'none', reason: 'The class has no creation time.' });
  });

  it('sorts by the controller, the parameters and the time of creation; a value the class does not state is missing', () => {
    const sortOf = (id: string, target: IngressClassRow) => ingressClassDefinition.fields.find((field) => field.id === id)!.sortValue(target);
    expect([sortOf('controller', external), sortOf('parameters', external)]).toEqual(['example.com/ingress-controller', 'IngressParameters/external-lb']);
    expect(sortOf('parameters', plain)).toBeUndefined();
    expect(sortOf('age', external)).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
    expect(sortOf('name', external)).toBe('external-lb');
  });
});
