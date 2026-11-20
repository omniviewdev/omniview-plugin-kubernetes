import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, type Capture, type CapturedObject } from '../testing';

import { roleDefinition } from './definition';
import { roleRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the Role object and the cells the server printed for it, taken together
// (fixtures/roles-table.json, made by hack/kinds-capture/capture.mjs on the cluster that more-kinds.sh and k2b2-kinds.yaml fill). `kubectl get roles -A` prints NAME and CREATED AT (it has no AGE
// column: K60.1 calls it Age). The age is therefore computed from CREATED AT against the server's clock, as kubectl would have printed it. Rules and Resources are printed by no column: they are
// checked against the object itself, with an independent computation (a Set over the flattened rules), not the code that reads them in the list.

type Rule = { readonly resources?: readonly string[]; readonly nonResourceURLs?: readonly string[] };

/** A capture whose objects are Roles: the part of the object the list reads, beside what every capture has. */
type RoleCapture = Omit<Capture, 'rows'> & { readonly rows: ReadonlyArray<{ readonly cells: Capture['rows'][number]['cells']; readonly object: CapturedObject & { readonly rules: readonly Rule[] | null } }> };

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/roles-table.json'), 'utf8')) as { captures: readonly RoleCapture[] };

const field = (id: string) => roleDefinition.fields.find((candidate) => candidate.id === id)!;

/** The names the rules reach, once each, in order: a rule's resources, else its URLs. */
const reached = (rules: readonly Rule[] | null): readonly string[] => [...new Set((rules ?? []).flatMap((rule) => rule.resources ?? rule.nonResourceURLs ?? []))];

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    it('prints a name and a creation time, and no Rules or Resources column: that is why the list reads the object', () => {
      expect(columns).toEqual(['Name', 'Created At']);
    });

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = roleRow(hostRecord(object, undefined, roleDefinition.type));

        it('Rules: the number of rules the object holds, zero for the null the API sends', () => {
          const rules = object.rules?.length ?? 0;
          expect(row.rules).toBe(rules);
          expect(field('rules').display(row, now)).toEqual({ kind: 'text', text: String(rules), mono: true });
        });

        it('Resources: the resources of the rules, else their URLs, once each, the first three in the cell and the whole list in the tip', () => {
          const names = reached(object.rules);
          expect(row.resources).toEqual(names);
          expect(field('resources').display(row, now)).toEqual(
            names.length === 0
              ? { kind: 'none', reason: 'The role grants no resource.' }
              : names.length > 3
                ? { kind: 'text', text: `${names.slice(0, 3).join(', ')} +${names.length - 3}`, tip: names.join(', ') }
                : { kind: 'text', text: names.join(', ') },
          );
        });

        it('Age: the age of kubectl\'s Created At lies in the span our one unit stands for', () => {
          // kubectl prints the timestamp; the age it would print is the server's clock less that timestamp, in whole seconds.
          const printed = Math.floor((now - Date.parse(cell(cells, 'Created At'))) / 1000);
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);

          expect(row.createdAt).toBe(Date.parse(cell(cells, 'Created At')));
          expect(printed).toBeGreaterThanOrEqual(from);
          expect(printed).toBeLessThan(to);
          expect(field('age').display(row, now)).toMatchObject({ kind: 'age', createdAt: row.createdAt });
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: a Role\'s name is not generated', () => {
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
  const rows = new Map(golden.captures.flatMap((capture) => capture.rows.map(({ object }) => [idOf(object), roleRow(hostRecord(object, undefined, roleDefinition.type))] as const)));

  it('holds a role with no rules, one with `*`, one that reaches more resources than the cell prints, and one with a single resource', () => {
    expect(rows.get('access/no-rules')).toMatchObject({ rules: 0, resources: [] });
    expect(rows.get('access/wildcard')).toMatchObject({ rules: 1, resources: ['*'] });
    expect(rows.get('access/many-rules')).toMatchObject({ rules: 4, resources: ['pods', 'pods/log', 'services', 'configmaps', 'deployments', 'statefulsets'] });
    expect(field('resources').display(rows.get('access/many-rules')!, 0)).toEqual({ kind: 'text', text: 'pods, pods/log, services +3', tip: 'pods, pods/log, services, configmaps, deployments, statefulsets' });
    expect(rows.get('access/pod-reader')).toMatchObject({ rules: 1, resources: ['pods'] });
    expect(rows.size).toBe(16);
  });

  it('holds a role whose later rule repeats a resource of an earlier one, so that the name is listed once, and one whose rules name different resources', () => {
    // `many-rules` names `pods` in its first and its last rule; `system:controller:token-cleaner` has a rule on secrets and one on events (apiGroups "" and events.k8s.io).
    const named = golden.captures.flatMap((capture) => capture.rows).find(({ object }) => idOf(object) === 'access/many-rules')!.object.rules!.flatMap((rule) => rule.resources ?? []);
    expect(named).toHaveLength(7);
    expect(rows.get('access/many-rules')?.resources).toHaveLength(6);
    expect(rows.get('kube-system/system:controller:token-cleaner')).toMatchObject({ rules: 2, resources: ['secrets', 'events'] });
  });
});
