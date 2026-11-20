import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, type Capture, type CapturedObject } from '../testing';

import { limitRangeDefinition } from './definition';
import { limitRangeRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the LimitRange object and the cells the server printed for it, taken together
// (fixtures/limitranges-table.json, made by hack/kinds-capture/capture.mjs on the cluster that k2b2-kinds.sh fills). `kubectl get limitranges -A` prints these cells: NAME CREATED AT, and no AGE: the
// printer of a LimitRange has none, and the mock calls the same time Age (K60.1). So the age is kubectl's own, worked out from CREATED AT against the clock of the server that printed it, and Items and
// Types, which kubectl does not print, are checked against the object itself, counted here by hand and not by the code that reads them in the list.

/** A capture whose objects are LimitRanges: the part of the object the golden reads beside what every capture has. */
type LimitRangeCapture = Omit<Capture, 'rows'> & {
  readonly rows: ReadonlyArray<{
    readonly cells: Capture['rows'][number]['cells'];
    readonly object: CapturedObject & { readonly metadata: { readonly creationTimestamp: string }; readonly spec: { readonly limits: ReadonlyArray<{ readonly type: string }> } };
  }>;
};

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/limitranges-table.json'), 'utf8')) as { captures: readonly LimitRangeCapture[] };

const field = (id: string) => limitRangeDefinition.fields.find((candidate) => candidate.id === id)!;

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = limitRangeRow(hostRecord(object, undefined, limitRangeDefinition.type));
        // What a person reads in the object: how many entries `spec.limits` has, and the type of each, once.
        const types = [...new Set(object.spec.limits.map((limit) => limit.type))];

        it('Items: the number of entries of spec.limits, which kubectl does not print', () => {
          expect(row.items).toBe(object.spec.limits.length);
          expect(field('items').display(row, now)).toEqual({ kind: 'text', text: String(object.spec.limits.length), mono: true });
        });

        it('Types: the type of each entry of spec.limits, once each and in order, which kubectl does not print', () => {
          // The cell holds the first three and the number of the rest: no entry of the fixture has more than three types, so the whole list is in the text.
          expect(types.length).toBeLessThanOrEqual(3);
          expect(row.types).toEqual(types);
          expect(field('types').display(row, now)).toEqual({ kind: 'text', text: types.join(', ') });
        });

        it('Age: kubectl prints CREATED AT, the time the object was made; its age at the server\'s clock lies in the span our one unit stands for', () => {
          const created = cell(cells, 'Created At');
          expect(created).toBe(object.metadata.creationTimestamp);

          // The age kubectl would print: the clock of the server less the time it printed. Both are whole seconds, so there is no second to give either way.
          const printed = (now - Date.parse(created)) / 1000;
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          expect(printed).toBeGreaterThanOrEqual(from);
          expect(printed).toBeLessThan(to);
          expect(field('age').display(row, now)).toMatchObject({ kind: 'age', createdAt: Date.parse(created), text: formatAge(Date.parse(created), now).text });
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: a LimitRange\'s name is not generated', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show', () => {
  const captured = golden.captures.flatMap((capture) => capture.rows.map(({ object }) => ({ capture, object, row: limitRangeRow(hostRecord(object, undefined, limitRangeDefinition.type)) })));
  const rows = new Map(captured.map((entry) => [idOf(entry.object), entry]));

  it('holds a LimitRange of one entry, one of two, and one of the three types a LimitRange can limit, in two Namespaces', () => {
    expect(rows.get('quotas/defaults')?.row).toMatchObject({ items: 1, types: ['Container'] });
    expect(rows.get('quotas/pod-and-claim')?.row).toMatchObject({ items: 2, types: ['Pod', 'PersistentVolumeClaim'] });
    expect(rows.get('ranges/all-three')?.row).toMatchObject({ items: 3, types: ['Container', 'Pod', 'PersistentVolumeClaim'] });
    expect(new Set(captured.map(({ row }) => row.namespace))).toEqual(new Set(['quotas', 'ranges']));
    expect(rows.size).toBe(3);
  });

  it('is a capture of kubectl\'s two columns, a name and the time it was made: no AGE, no limits', () => {
    for (const { capture } of captured) {
      expect(capture.columns).toEqual(['Name', 'Created At']);
    }
  });
});
