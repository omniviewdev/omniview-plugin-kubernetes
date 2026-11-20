import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { roleDefinition } from './definition';
import { roleRow, roleSearchText, type RoleRow } from './row';

// The Role definition, as the mock's `PRINTER.Role` has it (MOCK k8s-resource-definitions.js:846; ch17 K60.1 and K60.3): kubectl prints a name and the creation time only, so the list gets the next most
// useful columns, Rules (the mock's `ruleCount`) and Resources (the names the rules reach, `resourceNamesOf`: a rule's `resources`, else its `nonResourceURLs`), after the name, and Age. The mock has
// no quick filters for it. A ClusterRole has the same shape (`../clusterroles`).

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): RoleRow => roleRow(hostRecord(object, 'row:1', roleDefinition.type));
const role = (rules: unknown) => row({ metadata: { name: 'pod-reader', namespace: 'access', creationTimestamp: '2026-11-17T20:00:00Z' }, rules });
const cell = (id: string, target: RoleRow) => roleDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

const rule = (resources: readonly string[]) => ({ verbs: ['get'], apiGroups: [''], resources });

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(roleDefinition).toMatchObject({
      type: 'k8s:rbac.authorization.k8s.io/roles',
      identity: { group: 'rbac.authorization.k8s.io', version: 'v1', resource: 'roles' },
      kind: 'Role',
      nouns: { one: 'Role', other: 'Roles' },
      page: 'roles',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Rules, Resources, Age', () => {
    expect(roleDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['rules', 'Rules', false],
      ['resources', 'Resources', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: the count to the right, the resources take what is left', () => {
    const by = Object.fromEntries(roleDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.rules).toMatchObject({ fit: 'fixed', width: 54, align: 'right', sort: 'number' });
    expect(by.resources).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has one field for each column, in the same order', () => {
    expect(roleDefinition.fields.map((field) => field.id)).toEqual(roleDefinition.columns.map((column) => column.id));
  });

  it('has no quick filters, no detail page yet, and no tail to keep on a name that was not generated', () => {
    expect(roleDefinition.list.quickFilters).toEqual([]);
    expect(roleDefinition.detail).toBeUndefined();
    expect(roleDefinition.list.identity.tail(role([]))).toBe(0);
  });

  it('sorts by name, first, and puts the namespace under it', () => {
    expect(roleDefinition.list.defaultSort).toEqual({ id: 'name', direction: 'asc' });
    expect(roleDefinition.list.identity.second(role([]))).toBe('access');
    expect(roleDefinition.list.identity.second(row({ metadata: { name: 'odd' } }))).toBeNull();
  });
});

describe('the row: the rules, and the resources they reach', () => {
  it('counts the rules and names the resources of each, in order', () => {
    expect(role([rule(['pods', 'pods/log']), rule(['services'])])).toMatchObject({ name: 'pod-reader', namespace: 'access', rules: 2, resources: ['pods', 'pods/log', 'services'] });
  });

  it('names each resource once, at its first appearance', () => {
    expect(role([rule(['pods', 'services']), rule(['services', 'pods', 'nodes'])]).resources).toEqual(['pods', 'services', 'nodes']);
  });

  it('names the non-resource URLs of a rule that has no resources', () => {
    expect(role([{ verbs: ['get'], nonResourceURLs: ['/healthz', '/version'] }]).resources).toEqual(['/healthz', '/version']);
  });

  it('keeps `*` as a name like any other', () => {
    expect(role([rule(['*']), { verbs: ['*'], nonResourceURLs: ['*'] }])).toMatchObject({ rules: 2, resources: ['*'] });
  });

  it('does not fall back to the URLs for a rule whose resources are an empty list', () => {
    expect(role([{ verbs: ['get'], resources: [], nonResourceURLs: ['/healthz'] }])).toMatchObject({ rules: 1, resources: [] });
  });

  it('counts a rule that names nothing, and reads the names that are texts of one that names some', () => {
    expect(role([{ verbs: ['get'] }, 'odd', null, { resources: ['pods', 7, null] }])).toMatchObject({ rules: 4, resources: ['pods'] });
  });

  it('is zero rules and no resource for a role without rules: the API sends null, and kubectl would say nothing of them', () => {
    expect(role(null)).toMatchObject({ rules: 0, resources: [] });
    expect(role([])).toMatchObject({ rules: 0, resources: [] });
    expect(row({ metadata: { name: 'bare' } })).toMatchObject({ rules: 0, resources: [] });
  });

  it('says nothing of the rules when they are not a list: dashes, never a zero made up', () => {
    expect(role('pods')).toMatchObject({ rules: undefined, resources: undefined });
    expect(role({ resources: ['pods'] })).toMatchObject({ rules: undefined, resources: undefined });
  });

  it('says nothing of the rules for a body that is not an object', () => {
    for (const body of ['not an object', null, 7, ['a']]) {
      expect(row(body), JSON.stringify(body)).toMatchObject({ name: '', namespace: '', rules: undefined, resources: undefined, createdAt: undefined });
    }
  });

  it('searches the name, the namespace and the resources', () => {
    const text = roleSearchText(role([rule(['pods/log'])]));
    expect(text).toContain('pod-reader');
    expect(text).toContain('access');
    expect(text).toContain('pods/log');
  });
});

describe('the cells', () => {
  const several = role([rule(['pods', 'pods/log']), rule(['services', 'configmaps']), rule(['deployments'])]);

  it('draws the number of rules in the code face, zero included', () => {
    expect(cell('rules', several)).toEqual({ kind: 'text', text: '3', mono: true });
    expect(cell('rules', role(null))).toEqual({ kind: 'text', text: '0', mono: true });
  });

  it('draws the first three resources and the number of the rest, with every name in the tip', () => {
    expect(cell('resources', several)).toEqual({ kind: 'text', text: 'pods, pods/log, services +2', tip: 'pods, pods/log, services, configmaps, deployments' });
    expect(cell('resources', role([rule(['pods', 'services', 'nodes'])]))).toEqual({ kind: 'text', text: 'pods, services, nodes' });
    expect(cell('resources', role([rule(['*'])]))).toEqual({ kind: 'text', text: '*' });
  });

  it('draws a dash that says why for a role that grants no resource', () => {
    const none = { kind: 'none', reason: 'The role grants no resource.' };
    expect(cell('resources', role(null))).toEqual(none);
    expect(cell('resources', role([{ verbs: ['get'] }]))).toEqual(none);
  });

  it('draws dashes that say why for rules that could not be read', () => {
    expect(cell('rules', role('pods'))).toEqual({ kind: 'none', reason: 'The role\'s rules could not be read.' });
    expect(cell('resources', role('pods'))).toEqual({ kind: 'none', reason: 'The role\'s rules could not be read.' });
  });

  it('draws the age in one unit, with the time in the tip, and a dash that says why for an object with no creation time', () => {
    expect(cell('age', several)).toEqual({ kind: 'age', createdAt: Date.UTC(2026, 10, 17, 20, 0, 0), text: '2d', long: '2026-11-17 20:00 UTC · 2 days ago' });
    expect(cell('age', row({ metadata: { name: 'x' } }))).toEqual({ kind: 'none', reason: 'The Role has no creation time.' });
  });

  it('sorts by the number of rules and by the names, with a missing value last', () => {
    const sortOf = (id: string, target: RoleRow) => roleDefinition.fields.find((field) => field.id === id)!.sortValue(target);
    expect([sortOf('rules', several), sortOf('resources', several)]).toEqual([3, 'pods, pods/log, services, configmaps, deployments']);
    expect([sortOf('rules', role('x')), sortOf('resources', role('x'))]).toEqual([undefined, undefined]);
  });
});
