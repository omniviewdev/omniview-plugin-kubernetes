import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { networkPolicyDefinition } from './definition';
import { networkPolicyObject } from './object';
import { networkPolicyRow, networkPolicySearchText, type NetworkPolicyRow } from './row';

// The NetworkPolicy definition, as the mock's `PRINTER.NetworkPolicy` has it (MOCK k8s-resource-definitions.js:797; ch17 K60.3): after the name, the Pod selector and Age. The Columns chooser's set (Namespace,
// Policy types, Ingress rules, Egress rules) waits for the list page to have it. A NetworkPolicy has no state of its own, and the mock has no quick filters for it.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): NetworkPolicyRow => networkPolicyRow(hostRecord(object, 'row:1', networkPolicyDefinition.type));
const policy = (spec: Record<string, unknown> | undefined) =>
  row({ metadata: { name: 'allow-web', namespace: 'checkout', creationTimestamp: '2026-11-17T20:00:00Z' }, ...(spec === undefined ? {} : { spec }) });
const selecting = (podSelector: unknown) => policy({ podSelector, policyTypes: ['Ingress'] });
const cell = (id: string, target: NetworkPolicyRow) => networkPolicyDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

const web = selecting({ matchLabels: { app: 'web', tier: 'frontend' } });
const empty = selecting({});
const expressions = selecting({
  matchExpressions: [
    { key: 'app', operator: 'In', values: ['web', 'api'] },
    { key: 'env', operator: 'NotIn', values: ['dev'] },
    { key: 'tier', operator: 'Exists' },
    { key: 'zone', operator: 'DoesNotExist' },
  ],
});

describe('the definition', () => {
  it('names the type, the kind and the nouns: the plural of NetworkPolicy is NetworkPolicies (KL1)', () => {
    expect(networkPolicyDefinition).toMatchObject({
      type: 'k8s:networking.k8s.io/networkpolicies',
      identity: { group: 'networking.k8s.io', version: 'v1', resource: 'networkpolicies' },
      kind: 'NetworkPolicy',
      nouns: { one: 'NetworkPolicy', other: 'NetworkPolicies' },
      page: 'networkpolicies',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Pod selector, Age', () => {
    expect(networkPolicyDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['podSelector', 'Pod selector', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: the selector takes what is left', () => {
    const by = Object.fromEntries(networkPolicyDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.podSelector).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('puts the namespace under the name, has no quick filters and no detail page yet, and keeps no tail of a name that was not generated', () => {
    expect(networkPolicyDefinition.list.identity.second(web)).toBe('checkout');
    expect(networkPolicyDefinition.list.identity.second(row({ metadata: { name: 'allow-web' } }))).toBeNull();
    expect(networkPolicyDefinition.list.identity.tail(web)).toBe(0);
    expect(networkPolicyDefinition.list.quickFilters).toEqual([]);
    expect(networkPolicyDefinition.detail).toBeUndefined();
  });
});

describe('the row: the selector of the Pods the policy applies to', () => {
  it('says each label as key=value, in the order the object holds them', () => {
    expect(web).toMatchObject({ name: 'allow-web', namespace: 'checkout', podSelector: 'app=web, tier=frontend' });
    expect(selecting({ matchLabels: { tier: 'frontend', app: 'web' } }).podSelector).toBe('tier=frontend, app=web');
  });

  it('says each expression as the mock\'s `selectorLines` does: the key, the operator, and the values in parentheses when there are any, in the order the object holds them', () => {
    expect(expressions.podSelector).toBe('app In (web, api), env NotIn (dev), tier Exists, zone DoesNotExist');
  });

  it('says the labels first and then the expressions', () => {
    expect(selecting({ matchExpressions: [{ key: 'zone', operator: 'DoesNotExist' }], matchLabels: { role: 'db' } }).podSelector).toBe('role=db, zone DoesNotExist');
  });

  it('says what a selector made of expressions alone requires, never All pods: the mock reads only the labels and would say it of such a selector, and it is false', () => {
    expect(selecting({ matchExpressions: [{ key: 'tier', operator: 'Exists' }] }).podSelector).toBe('tier Exists');
  });

  it('says All pods for an empty selector: it selects every Pod of the Namespace', () => {
    expect(empty.podSelector).toBe('All pods');
    expect(selecting({ matchLabels: {}, matchExpressions: [] }).podSelector).toBe('All pods');
  });

  it('says nothing for a policy that states no pod selector, and for a pod selector that is not an object', () => {
    expect(policy({ policyTypes: ['Ingress'] }).podSelector).toBeUndefined();
    expect(policy({}).podSelector).toBeUndefined();
    expect(policy(undefined).podSelector).toBeUndefined();
    for (const podSelector of ['app=web', null, 7, ['app=web']]) {
      expect(selecting(podSelector).podSelector, JSON.stringify(podSelector)).toBeUndefined();
    }
  });

  it('does not read a label that is not text, nor an expression that names no key or no operator, nor a value that is not text: the API accepts none of them', () => {
    const odd = selecting({
      matchLabels: { app: 'web', replicas: 7 },
      matchExpressions: [{ key: 'x' }, { operator: 'Exists' }, 'tier', { key: 'zone', operator: 'In', values: ['a', 7, 'b'] }],
    });
    expect(odd.podSelector).toBe('app=web, zone In (a, b)');
  });

  it('does not throw on a body that is not a NetworkPolicy: an empty identity and nothing else', () => {
    for (const body of [{}, null, 'text', 7, [], { metadata: { name: 7 } }]) {
      expect(row(body), JSON.stringify(body)).toMatchObject({ name: '', namespace: '', nameTail: 0, podSelector: undefined, createdAt: undefined });
    }

    expect(networkPolicyObject(hostRecord('text', 'row:x', networkPolicyDefinition.type))).toEqual({});
  });

  it('searches the name, the namespace and the selector, All pods included', () => {
    const text = networkPolicySearchText(expressions);
    for (const part of ['allow-web', 'checkout', 'app in (web, api)', 'zone doesnotexist']) {
      expect(text).toContain(part);
    }

    expect(networkPolicySearchText(empty)).toContain('all pods');
    expect(text).toBe(text.toLowerCase());
  });
});

describe('the cells', () => {
  it('draws the selector as plain text, and the age', () => {
    expect(cell('podSelector', web)).toEqual({ kind: 'text', text: 'app=web, tier=frontend' });
    expect(cell('podSelector', expressions)).toEqual({ kind: 'text', text: 'app In (web, api), env NotIn (dev), tier Exists, zone DoesNotExist' });
    expect(cell('age', web)).toMatchObject({ kind: 'age', text: '2d' });
  });

  it('draws All pods for an empty selector: a statement of the policy, not a dash', () => {
    expect(cell('podSelector', empty)).toEqual({ kind: 'text', text: 'All pods' });
  });

  it('draws a dash that says why for a policy that states no pod selector, and for a body with no creation time', () => {
    expect(cell('podSelector', policy({}))).toEqual({ kind: 'none', reason: 'The policy states no pod selector.' });
    expect(cell('age', row({ metadata: { name: 'allow-web' } }))).toEqual({ kind: 'none', reason: 'The policy has no creation time.' });
  });

  it('sorts by the text of the selector (All pods is a text like another), by the time of creation, and puts a policy with no selector nowhere: its value is missing', () => {
    const sortOf = (id: string, target: NetworkPolicyRow) => networkPolicyDefinition.fields.find((field) => field.id === id)!.sortValue(target);
    expect(sortOf('podSelector', web)).toBe('app=web, tier=frontend');
    expect(sortOf('podSelector', empty)).toBe('All pods');
    expect(sortOf('podSelector', policy({}))).toBeUndefined();
    expect(sortOf('age', web)).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
    expect(sortOf('name', web)).toBe('allow-web');
  });
});
