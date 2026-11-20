import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { clusterRoleBindingDefinition } from './definition';
import { clusterRoleBindingRow, clusterRoleBindingSearchText, type ClusterRoleBindingRow } from './row';

// The ClusterRoleBinding definition, as the mock's `PRINTER.ClusterRoleBinding` has it (MOCK k8s-resource-definitions.js:852-855 and the `'reference'` case of `displayCell`; ch17 K60.1 and K60.3): after
// the name, Role (`roleRef`: the name alone, with `Kind/name` in the tip, when the kind is the one a ClusterRoleBinding implies, a ClusterRole), Subjects (the name of each subject, the first two) and
// Age. The mock's Users, Groups and Service accounts columns wait for the Columns chooser. It has no quick filters. It is the shape of a RoleBinding (`../rolebindings`) with no namespace.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): ClusterRoleBindingRow => clusterRoleBindingRow(hostRecord(object, 'row:1', clusterRoleBindingDefinition.type));
const binding = (extra: Record<string, unknown>) => row({ metadata: { name: 'k2b2-readers', creationTimestamp: '2026-11-17T20:00:00Z' }, ...extra });
const cell = (id: string, target: ClusterRoleBindingRow) => clusterRoleBindingDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

const roleRef = (kind: string, name: string) => ({ apiGroup: 'rbac.authorization.k8s.io', kind, name });
const user = (name: string) => ({ kind: 'User', apiGroup: 'rbac.authorization.k8s.io', name });
const group = (name: string) => ({ kind: 'Group', apiGroup: 'rbac.authorization.k8s.io', name });
const account = (name: string, namespace: string) => ({ kind: 'ServiceAccount', name, namespace });

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(clusterRoleBindingDefinition).toMatchObject({
      type: 'k8s:rbac.authorization.k8s.io/clusterrolebindings',
      identity: { group: 'rbac.authorization.k8s.io', version: 'v1', resource: 'clusterrolebindings' },
      kind: 'ClusterRoleBinding',
      nouns: { one: 'ClusterRoleBinding', other: 'ClusterRoleBindings' },
      page: 'clusterrolebindings',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Role, Subjects, Age', () => {
    expect(clusterRoleBindingDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['role', 'Role', false],
      ['subjects', 'Subjects', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: the role and the subjects take what is left', () => {
    const by = Object.fromEntries(clusterRoleBindingDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.role).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.subjects).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has one field for each column, in the same order', () => {
    expect(clusterRoleBindingDefinition.fields.map((field) => field.id)).toEqual(clusterRoleBindingDefinition.columns.map((column) => column.id));
  });

  it('has no quick filters, no detail page yet, and no tail to keep on a name that was not generated', () => {
    expect(clusterRoleBindingDefinition.list.quickFilters).toEqual([]);
    expect(clusterRoleBindingDefinition.detail).toBeUndefined();
    expect(clusterRoleBindingDefinition.list.identity.tail(binding({}))).toBe(0);
  });

  it('sorts by name, first, and has no second line: a ClusterRoleBinding lives in no namespace', () => {
    expect(clusterRoleBindingDefinition.list.defaultSort).toEqual({ id: 'name', direction: 'asc' });
    expect(clusterRoleBindingDefinition.list.identity.second(binding({}))).toBeNull();
  });
});

describe('the row: the role it binds and the subjects it binds it to', () => {
  it('holds the kind and name of the role, and the name of each subject, in order', () => {
    expect(binding({ roleRef: roleRef('ClusterRole', 'k2b2-reader'), subjects: [group('k2b2:readers'), user('bob'), account('builder', 'access')] })).toMatchObject({
      name: 'k2b2-readers',
      namespace: '',
      role: { kind: 'ClusterRole', name: 'k2b2-reader' },
      subjects: ['k2b2:readers', 'bob', 'builder'],
    });
  });

  it('names each subject once, at its first appearance: a User and a ServiceAccount of the same name, or the same account of two namespaces, are one name', () => {
    expect(binding({ subjects: [user('ci'), account('ci', 'a'), account('ci', 'b'), group('devs')] }).subjects).toEqual(['ci', 'devs']);
  });

  it('skips a subject with no name, and keeps the others', () => {
    expect(binding({ subjects: [{ kind: 'User' }, 'odd', null, user('alice')] }).subjects).toEqual(['alice']);
  });

  it('has no subjects for a binding without any: the API sends null, or nothing', () => {
    expect(binding({ roleRef: roleRef('ClusterRole', 'x'), subjects: null }).subjects).toEqual([]);
    expect(binding({ subjects: [] }).subjects).toEqual([]);
    expect(binding({}).subjects).toEqual([]);
  });

  it('says nothing of the subjects when they are not a list, and nothing of a role reference that lacks its kind or its name', () => {
    expect(binding({ subjects: 'alice' }).subjects).toBeUndefined();
    expect(binding({ roleRef: 'view' }).role).toBeUndefined();
    expect(binding({ roleRef: { kind: 'ClusterRole' } }).role).toBeUndefined();
    expect(binding({ roleRef: { name: 'view' } }).role).toBeUndefined();
    expect(binding({}).role).toBeUndefined();
  });

  it('says nothing of the role and the subjects for a body that is not an object', () => {
    for (const body of ['not an object', null, 7, ['a']]) {
      expect(row(body), JSON.stringify(body)).toMatchObject({ name: '', namespace: '', role: undefined, subjects: undefined, createdAt: undefined });
    }
  });

  it('searches the name, the role as Kind/name and the subjects', () => {
    const text = clusterRoleBindingSearchText(binding({ roleRef: roleRef('ClusterRole', 'view'), subjects: [group('devs'), account('builder', 'access')] }));
    expect(text).toContain('k2b2-readers');
    expect(text).toContain('clusterrole/view');
    expect(text).toContain('devs');
    expect(text).toContain('builder');
  });
});

describe('the cells', () => {
  it('draws the name of a ClusterRole, which a ClusterRoleBinding implies, with Kind/name in the tip', () => {
    expect(cell('role', binding({ roleRef: roleRef('ClusterRole', 'cluster-admin') }))).toEqual({ kind: 'text', text: 'cluster-admin', tip: 'ClusterRole/cluster-admin' });
  });

  it('draws any other kind whole, with no tip: a ClusterRoleBinding does not imply it', () => {
    expect(cell('role', binding({ roleRef: roleRef('Role', 'pod-reader') }))).toEqual({ kind: 'text', text: 'Role/pod-reader' });
  });

  it('draws a dash that says why for a binding that names no role', () => {
    expect(cell('role', binding({}))).toEqual({ kind: 'none', reason: 'The binding names no role.' });
    expect(cell('role', row('not an object')).kind).toBe('none');
  });

  it('draws the first two subjects and the number of the rest, with every name in the tip', () => {
    expect(cell('subjects', binding({ subjects: [group('k2b2:readers'), user('bob'), account('builder', 'access')] }))).toEqual({ kind: 'text', text: 'k2b2:readers, bob +1', tip: 'k2b2:readers, bob, builder' });
    expect(cell('subjects', binding({ subjects: [group('system:masters')] }))).toEqual({ kind: 'text', text: 'system:masters' });
  });

  it('draws a dash that says why for a binding with no subjects, and for subjects that could not be read', () => {
    expect(cell('subjects', binding({ subjects: null }))).toEqual({ kind: 'none', reason: 'The binding has no subjects.' });
    expect(cell('subjects', binding({ subjects: 'alice' }))).toEqual({ kind: 'none', reason: 'The binding\'s subjects could not be read.' });
    expect(cell('subjects', row('not an object')).kind).toBe('none');
  });

  it('draws the age in one unit, with the time in the tip, and a dash that says why for an object with no creation time', () => {
    expect(cell('age', binding({}))).toEqual({ kind: 'age', createdAt: Date.UTC(2026, 10, 17, 20, 0, 0), text: '2d', long: '2026-11-17 20:00 UTC · 2 days ago' });
    expect(cell('age', row({ metadata: { name: 'x' } }))).toEqual({ kind: 'none', reason: 'The ClusterRoleBinding has no creation time.' });
  });

  it('sorts by the role as Kind/name and by the subjects\' names, with a missing value last', () => {
    const sortOf = (id: string, target: ClusterRoleBindingRow) => clusterRoleBindingDefinition.fields.find((field) => field.id === id)!.sortValue(target);
    const full = binding({ roleRef: roleRef('ClusterRole', 'view'), subjects: [user('alice'), group('devs')] });
    expect([sortOf('role', full), sortOf('subjects', full)]).toEqual(['ClusterRole/view', 'alice, devs']);
    expect([sortOf('role', binding({})), sortOf('subjects', binding({ subjects: 'x' }))]).toEqual([undefined, undefined]);
  });
});
