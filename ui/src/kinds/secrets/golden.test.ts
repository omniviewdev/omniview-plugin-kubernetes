import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture, type CapturedObject } from '../testing';

import { secretDefinition } from './definition';
import { secretRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the Secret object and the cells the server printed for it, taken together
// (fixtures/secrets-table.json, made by hack/kinds-capture/capture.mjs on the cluster that more-kinds.sh fills). `kubectl get secrets -A` prints these cells: NAME TYPE DATA AGE. DATA is the number of keys
// of data. The fixture keeps no value: capture.mjs empties each one, so this file holds the keys of real Secrets and nothing they held.

/** What the fixture holds of a Secret beside its identity: the keys, with their values emptied, and the annotations, ditto. */
type Held = { readonly data?: Readonly<Record<string, string>>; readonly metadata: CapturedObject['metadata'] & { readonly annotations?: Readonly<Record<string, string>> } };

type SecretCapture = Omit<Capture, 'rows'> & { readonly rows: ReadonlyArray<{ readonly cells: Capture['rows'][number]['cells']; readonly object: CapturedObject & Held }> };

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/secrets-table.json'), 'utf8')) as { captures: readonly SecretCapture[] };

const field = (id: string) => secretDefinition.fields.find((candidate) => candidate.id === id)!;

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = secretRow(hostRecord(object, undefined, secretDefinition.type));

        it('Type: the type kubectl prints, as the platform spells it', () => {
          expect(row.type).toBe(cell(cells, 'Type'));
          expect(field('type').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'Type') });
        });

        it('Keys: the number kubectl prints as DATA', () => {
          expect(row.keys).toBe(Number(cell(cells, 'Data')));
          expect(field('keys').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'Data'), mono: true });
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: a Secret\'s name is not generated', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show, and keeps no value', () => {
  const rows = golden.captures.flatMap((capture) => capture.rows);

  it('holds the types a cluster has: Opaque, dockerconfigjson, tls, service-account-token and the bootstrap token, one of them with no key', () => {
    expect(new Set(rows.map(({ cells }) => cells[1]))).toEqual(
      new Set(['Opaque', 'kubernetes.io/dockerconfigjson', 'kubernetes.io/tls', 'kubernetes.io/service-account-token', 'bootstrap.kubernetes.io/token']),
    );
    expect(rows.filter(({ cells }) => cells[2] === 0)).toHaveLength(1);
    expect(rows).toHaveLength(6);
  });

  it('keeps no Secret value, and no annotation value: every one is empty (a fixture that holds one is a leak)', () => {
    for (const { object } of rows) {
      expect(Object.values(object.data ?? {}).every((value) => value === ''), idOf(object)).toBe(true);
      expect(Object.values(object.metadata.annotations ?? {}).every((value) => value === ''), idOf(object)).toBe(true);
    }
  });
});
