import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture, type CapturedObject } from '../testing';

import { serviceAccountDefinition } from './definition';
import { serviceAccountRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the ServiceAccount object and the cells the server printed for it, taken together
// (fixtures/serviceaccounts-table.json, made by hack/kinds-capture/capture.mjs on the cluster that more-kinds.sh and k2b2-kinds.yaml fill). `kubectl get serviceaccounts -A` prints NAME and AGE only: this
// server's table has no SECRETS column, so the Secrets column is checked against the object itself (the length of its `secrets`, counted here with `?.length ?? 0`, not by the code that reads it in the list).

/** A capture whose objects are ServiceAccounts: the part of the object the list reads, beside what every capture has. */
type ServiceAccountCapture = Omit<Capture, 'rows'> & {
  readonly rows: ReadonlyArray<{ readonly cells: Capture['rows'][number]['cells']; readonly object: CapturedObject & { readonly secrets?: readonly unknown[] } }>;
};

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/serviceaccounts-table.json'), 'utf8')) as { captures: readonly ServiceAccountCapture[] };

const field = (id: string) => serviceAccountDefinition.fields.find((candidate) => candidate.id === id)!;

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    it('prints a name and an age, and no Secrets column: that is why the list reads the object', () => {
      expect(columns).toEqual(['Name', 'Age']);
    });

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = serviceAccountRow(hostRecord(object, undefined, serviceAccountDefinition.type));

        it('Secrets: the entries of `secrets` the object holds, none when it holds none', () => {
          const secrets = object.secrets?.length ?? 0;
          expect(row.secrets).toBe(secrets);
          expect(field('secrets').display(row, now)).toEqual({ kind: 'text', text: String(secrets), mono: true });
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: a ServiceAccount\'s name is not generated', () => {
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
  const rows = new Map(golden.captures.flatMap((capture) => capture.rows.map(({ object }) => [idOf(object), serviceAccountRow(hostRecord(object, undefined, serviceAccountDefinition.type))] as const)));

  it('holds an account with two secrets, the accounts without any, every namespace\'s `default` and the controllers\' in kube-system', () => {
    expect(rows.get('access/legacy')?.secrets).toBe(2);
    expect(rows.get('access/builder')?.secrets).toBe(0);
    expect(rows.get('access/deployer')?.secrets).toBe(0);
    expect(rows.get('kube-system/legacy-service-account-token-cleaner')?.secrets).toBe(0);
    expect([...rows.values()].filter((row) => row.secrets !== 0).map((row) => row.name)).toEqual(['legacy']);
    expect([...rows.values()].filter((row) => row.name === 'default').map((row) => row.namespace)).toContain('default');
    expect(rows.size).toBe(60);
  });
});
