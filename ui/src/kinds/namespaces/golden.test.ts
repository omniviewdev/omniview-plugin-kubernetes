import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture } from '../testing';

import { namespaceDefinition } from './definition';
import { namespaceRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the Namespace object and the cells the server printed for it, taken together
// (fixtures/namespaces-table.json, made by hack/kinds-capture/capture.mjs on the cluster that more-kinds.sh fills). `kubectl get namespaces` prints these cells: NAME STATUS AGE. STATUS is the
// phase, and the word of the list is the same word. A Namespace lives in no namespace, so the object has none and the row has none.

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/namespaces-table.json'), 'utf8')) as { captures: readonly Capture[] };

const field = (id: string) => namespaceDefinition.fields.find((candidate) => candidate.id === id)!;

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = namespaceRow(hostRecord(object, undefined, namespaceDefinition.type));

        it('Status: the word kubectl prints, with the role the table gives it', () => {
          expect(row.status?.word).toBe(cell(cells, 'Status'));
          expect(field('status').display(row, now)).toMatchObject({ kind: 'status', raw: cell(cells, 'Status'), label: cell(cells, 'Status') });
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name: the identity kubectl prints, in no namespace and with no second line and no tail', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(object.metadata.namespace).toBeUndefined();
          expect(row.namespace).toBe('');
          expect(namespaceDefinition.list.identity.second(row)).toBeNull();
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers the states the list has to show', () => {
  const rows = golden.captures.flatMap((capture) => capture.rows.map(({ object }) => namespaceRow(hostRecord(object, undefined, namespaceDefinition.type))));

  it('holds both words, the Namespace that cannot finish being deleted among them', () => {
    expect(new Set(rows.map((row) => row.status?.word))).toEqual(new Set(['Active', 'Terminating']));
    expect(rows.find((row) => row.name === 'terminating')?.status?.word).toBe('Terminating');
  });

  it('counts the quick filters over the rows', () => {
    const counts = Object.fromEntries(namespaceDefinition.list.quickFilters.map((filter) => [filter.id, rows.filter(filter.test).length]));

    expect(counts).toEqual({ active: 10, terminating: 1 });
    expect(rows).toHaveLength(11);
  });
});
