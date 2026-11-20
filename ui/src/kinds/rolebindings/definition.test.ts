import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { roleBindingDefinition } from './definition';
import { roleBindingRow, roleBindingSearchText, type RoleBindingRow } from './row';

// The RoleBinding definition, as the mock's `PRINTER.RoleBinding` has it (MOCK k8s-resource-definitions.js:848-851 and the `'reference'` case of `displayCell`; ch17 K60.1 and K60.3): after the name,
// Role (`roleRef`: the name alone, with `Kind/name` in the tip, when the kind is the one a RoleBinding implies, a Role), Subjects (the name of each subject, the first two) and Age. The mock's Users,
// Groups and Service accounts columns wait for the Columns chooser. It has no quick filters. A ClusterRoleBinding has the same shape (`../clusterrolebindings`).

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): RoleBindingRow => roleBindingRow(hostRecord(object, 'row:1', roleBindingDefinition.type));
const binding = (extra: Record<string, unknown>) => row({ metadata: { name: 'read-pods', namespace: 'access', creationTimestamp: '2026-11-17T20:00:00Z' }, ...extra });
const cell = (id: string, target: RoleBindingRow) => roleBindingDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

const roleRef = (kind: string, name: string) => ({ apiGroup: 'rbac.authorization.k8s.io', kind, name });
const user = (name: string) => ({ kind: 'User', apiGroup: 'rbac.authorization.k8s.io', name });
const group = (name: string) => ({ kind: 'Group', apiGroup: 'rbac.authorization.k8s.io', name });
const account = (name: string, namespace: string) => ({ kind: 'ServiceAccount', name, namespace });

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(roleBindingDefinition).toMatchObject({
      type: 'k8s:rbac.authorization.k8s.io/rolebindings',
      identity: { group: 'rbac.authorization.k8s.io', version: 'v1', resource: 'rolebindings' },
      kind: 'RoleBinding',
      nouns: { one: 'RoleBinding', other: 'RoleBindings' },
      page: 'rolebindings',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Role, Subjects, Age', () => {
    expect(roleBindingDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['role', 'Role', false],
      ['subjects', 'Subjects', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: the role and the subjects take what is left', () => {
    const by = Object.fromEntries(roleBindingDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.role).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.subjects).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has one field for each column, in the same order', () => {
    expect(roleBindingDefinition.fields.map((field) => field.id)).toEqual(roleBindingDefinition.columns.map((column) => column.id));
  });

  it('has no quick filters, no detail page yet, and no tail to keep on a name that was not generated', () => {
    expect(roleBindingDefinition.list.quickFilters).toEqual([]);
    expect(roleBindingDefinition.detail).toBeUndefined();
    expect(roleBindingDefinition.list.identity.tail(binding({}))).toBe(0);
  });

  it('sorts by name, first, and puts the namespace under it', () => {
    expect(roleBindingDefinition.list.defaultSort).toEqual({ id: 'name', direction: 'asc' });
    expect(roleBindingDefinition.list.identity.second(binding({}))).toBe('access');
    expect(roleBindingDefinition.list.identity.second(row({ metadata: { name: 'odd' } }))).toBeNull();
  });
});

describe('the row: the role it binds and the subjects it binds it to', () => {
  it('holds the kind and name of the role, and the name of each subject, in order', () => {
    expect(binding({ roleRef: roleRef('Role', 'pod-reader'), subjects: [user('alice'), group('devs'), account('builder', 'access')] })).toMatchObject({
      name: 'read-pods',
      namespace: 'access',
      role: { kind: 'Role', name: 'pod-reader' },
      subjects: ['alice', 'devs', 'builder'],
    });
  });

  it('names each subject once, at its first appearance: a User and a ServiceAccount of the same name, or the same account of two namespaces, are one name', () => {
    expect(binding({ subjects: [user('ci'), account('ci', 'a'), account('ci', 'b'), group('devs')] }).subjects).toEqual(['ci', 'devs']);
  });

  it('skips a subject with no name, and keeps the others', () => {
    expect(binding({ subjects: [{ kind: 'User' }, 'odd', null, user('alice')] }).subjects).toEqual(['alice']);
  });

  it('has no subjects for a binding without any: the API sends null, or nothing', () => {
    expect(binding({ roleRef: roleRef('Role', 'x'), subjects: null }).subjects).toEqual([]);
    expect(binding({ subjects: [] }).subjects).toEqual([]);
    expect(binding({}).subjects).toEqual([]);
  });

  it('says nothing of the subjects when they are not a list, and nothing of a role reference that lacks its kind or its name', () => {
    expect(binding({ subjects: 'alice' }).subjects).toBeUndefined();
    expect(binding({ roleRef: 'view' }).role).toBeUndefined();
    expect(binding({ roleRef: { kind: 'Role' } }).role).toBeUndefined();
    expect(binding({ roleRef: { name: 'view' } }).role).toBeUndefined();
    expect(binding({}).role).toBeUndefined();
  });

  it('says nothing of the role and the subjects for a body that is not an object', () => {
    for (const body of ['not an object', null, 7, ['a']]) {
      expect(row(body), JSON.stringify(body)).toMatchObject({ name: '', namespace: '', role: undefined, subjects: undefined, createdAt: undefined });
    }
  });

  it('searches the name, the namespace, the role as Kind/name and the subjects', () => {
    const text = roleBindingSearchText(binding({ roleRef: roleRef('ClusterRole', 'view'), subjects: [group('devs'), account('builder', 'access')] }));
    expect(text).toContain('read-pods');
    expect(text).toContain('access');
    expect(text).toContain('clusterrole/view');
    expect(text).toContain('devs');
    expect(text).toContain('builder');
  });
});

describe('the cells', () => {
  it('draws the name of a Role, which a RoleBinding implies, with Kind/name in the tip', () => {
    expect(cell('role', binding({ roleRef: roleRef('Role', 'pod-reader') }))).toEqual({ kind: 'text', text: 'pod-reader', tip: 'Role/pod-reader' });
  });

  it('draws a ClusterRole whole, with no tip: a RoleBinding does not imply it', () => {
    expect(cell('role', binding({ roleRef: roleRef('ClusterRole', 'view') }))).toEqual({ kind: 'text', text: 'ClusterRole/view' });
  });

  it('draws a dash that says why for a binding that names no role', () => {
    expect(cell('role', binding({}))).toEqual({ kind: 'none', reason: 'The binding names no role.' });
    expect(cell('role', row('not an object')).kind).toBe('none');
  });

  it('draws the first two subjects and the number of the rest, with every name in the tip', () => {
    expect(cell('subjects', binding({ subjects: [user('alice'), group('devs'), account('builder', 'access')] }))).toEqual({ kind: 'text', text: 'alice, devs +1', tip: 'alice, devs, builder' });
    expect(cell('subjects', binding({ subjects: [user('alice'), group('devs')] }))).toEqual({ kind: 'text', text: 'alice, devs' });
    expect(cell('subjects', binding({ subjects: [account('builder', 'access')] }))).toEqual({ kind: 'text', text: 'builder' });
  });

  it('draws a dash that says why for a binding with no subjects, and for subjects that could not be read', () => {
    expect(cell('subjects', binding({ subjects: null }))).toEqual({ kind: 'none', reason: 'The binding has no subjects.' });
    expect(cell('subjects', binding({ subjects: 'alice' }))).toEqual({ kind: 'none', reason: 'The binding\'s subjects could not be read.' });
    expect(cell('subjects', row('not an object')).kind).toBe('none');
  });

  it('draws the age in one unit, with the time in the tip, and a dash that says why for an object with no creation time', () => {
    expect(cell('age', binding({}))).toEqual({ kind: 'age', createdAt: Date.UTC(2026, 10, 17, 20, 0, 0), text: '2d', long: '2026-11-17 20:00 UTC · 2 days ago' });
    expect(cell('age', row({ metadata: { name: 'x' } }))).toEqual({ kind: 'none', reason: 'The RoleBinding has no creation time.' });
  });

  it('sorts by the role as Kind/name and by the subjects\' names, with a missing value last', () => {
    const sortOf = (id: string, target: RoleBindingRow) => roleBindingDefinition.fields.find((field) => field.id === id)!.sortValue(target);
    const full = binding({ roleRef: roleRef('Role', 'pod-reader'), subjects: [user('alice'), group('devs'), account('builder', 'access')] });
    expect([sortOf('role', full), sortOf('subjects', full)]).toEqual(['Role/pod-reader', 'alice, devs, builder']);
    expect([sortOf('role', binding({})), sortOf('subjects', binding({ subjects: 'x' }))]).toEqual([undefined, undefined]);
  });
});
