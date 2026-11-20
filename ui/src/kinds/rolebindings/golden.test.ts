import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture, type CapturedObject } from '../testing';

import { roleBindingDefinition } from './definition';
import { roleBindingRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the RoleBinding object and the cells the server printed for it, taken together
// (fixtures/rolebindings-table.json, made by hack/kinds-capture/capture.mjs on the cluster that more-kinds.sh and k2b2-kinds.yaml fill). `kubectl get rolebindings -A -o wide` prints NAME ROLE AGE and, at
// priority 1, USERS GROUPS SERVICEACCOUNTS (the ServiceAccounts as `namespace/name`). Two presentation mappings: the Role cell is the name with `Role/name` in its tip, where kubectl prints `Role/name`
// (a ClusterRole is whole in both); and the Subjects cell is the name of every subject in the order of `subjects`, where kubectl groups them by kind. The Subjects are checked against the object with an
// independent computation, and against the three priority-1 columns, which together name every subject.

type Subject = { readonly kind: string; readonly name: string; readonly namespace?: string };

/** A capture whose objects are RoleBindings: the part of the object the list reads, beside what every capture has. */
type RoleBindingCapture = Omit<Capture, 'rows'> & {
  readonly rows: ReadonlyArray<{
    readonly cells: Capture['rows'][number]['cells'];
    readonly object: CapturedObject & { readonly roleRef: { readonly kind: string; readonly name: string }; readonly subjects: readonly Subject[] | null };
  }>;
};

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/rolebindings-table.json'), 'utf8')) as { captures: readonly RoleBindingCapture[] };

const field = (id: string) => roleBindingDefinition.fields.find((candidate) => candidate.id === id)!;

/** The names kubectl prints in one of its priority-1 columns, apart: a ServiceAccount's `namespace/` is cut. */
const printedNames = (printed: string, accounts = false): readonly string[] => (printed === '' ? [] : printed.split(', ').map((name) => (accounts ? name.slice(name.indexOf('/') + 1) : name)));

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    it('prints the role and the age, and the users, groups and service accounts apart (priority 1)', () => {
      expect(columns).toEqual(['Name', 'Role', 'Age', 'Users', 'Groups', 'ServiceAccounts']);
    });

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = roleBindingRow(hostRecord(object, undefined, roleBindingDefinition.type));

        it('Role: the Kind/name kubectl prints, as the name with Kind/name in the tip for a Role, and whole for any other kind', () => {
          const printed = cell(cells, 'Role');
          expect(printed).toBe(`${object.roleRef.kind}/${object.roleRef.name}`);

          const shown = field('role').display(row, now);
          expect(shown).toEqual(object.roleRef.kind === 'Role' ? { kind: 'text', text: object.roleRef.name, tip: printed } : { kind: 'text', text: printed });
        });

        it('Subjects: the name of each subject once, in order, the first two in the cell and the whole list in the tip', () => {
          const names = [...new Set((object.subjects ?? []).map((subject) => subject.name))];
          expect(row.subjects).toEqual(names);
          expect(field('subjects').display(row, now)).toEqual(
            names.length === 0
              ? { kind: 'none', reason: 'The binding has no subjects.' }
              : names.length > 2
                ? { kind: 'text', text: `${names.slice(0, 2).join(', ')} +${names.length - 2}`, tip: names.join(', ') }
                : { kind: 'text', text: names.join(', ') },
          );
        });

        it('Subjects: kubectl\'s users, groups and service accounts together name the same subjects', () => {
          const printed = [...printedNames(cell(cells, 'Users')), ...printedNames(cell(cells, 'Groups')), ...printedNames(cell(cells, 'ServiceAccounts'), true)];
          expect([...(row.subjects ?? [])].sort()).toEqual([...new Set(printed)].sort());
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: a RoleBinding\'s name is not generated', () => {
          expect(cell(cells, 'Name')).toBe(object.metadata.name);
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show', () => {
  const rows = new Map(golden.captures.flatMap((capture) => capture.rows.map(({ object }) => [idOf(object), roleBindingRow(hostRecord(object, undefined, roleBindingDefinition.type))] as const)));
  const shown = (id: string, column: string) => field(column).display(rows.get(id)!, 0);

  it('holds a binding of a user, a group and a service account, whose three names are two in the cell and one more', () => {
    expect(rows.get('access/read-pods')).toMatchObject({ role: { kind: 'Role', name: 'pod-reader' }, subjects: ['alice', 'devs', 'builder'] });
    expect(shown('access/read-pods', 'subjects')).toEqual({ kind: 'text', text: 'alice, devs +1', tip: 'alice, devs, builder' });
  });

  it('holds a RoleBinding to a ClusterRole, which the cell says whole', () => {
    expect(rows.get('access/cluster-view')).toMatchObject({ role: { kind: 'ClusterRole', name: 'view' }, subjects: ['deployer'] });
    expect(shown('access/cluster-view', 'role')).toEqual({ kind: 'text', text: 'ClusterRole/view' });
  });

  it('holds a binding with no subjects, and bindings of groups and of the cluster\'s own controllers', () => {
    expect(rows.get('access/no-subjects')).toMatchObject({ subjects: [] });
    expect(shown('access/no-subjects', 'subjects')).toEqual({ kind: 'none', reason: 'The binding has no subjects.' });
    expect(rows.get('kube-system/kubeadm:kubelet-config')?.subjects).toEqual(['system:nodes', 'system:bootstrappers:kubeadm:default-node-token']);
    expect(rows.get('kube-system/system::leader-locking-kube-controller-manager')?.subjects).toHaveLength(3);
    expect(rows.size).toBe(16);
  });
});
