import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, kubectlSeconds, type Capture } from '../testing';

import { jobDefinition } from './definition';
import { jobRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the Job object and the cells the server printed for it, taken together
// (fixtures/jobs-table.json, made by hack/kinds-capture/capture.mjs on the slice fixture and extra-states.yaml). `kubectl get jobs -A` prints these cells: NAME STATUS COMPLETIONS DURATION AGE.
// Of the five kinds this is the one whose state word kubectl prints itself.

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/jobs-table.json'), 'utf8')) as { captures: readonly Capture[] };

const field = (id: string) => jobDefinition.fields.find((candidate) => candidate.id === id)!;

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = `${object.metadata.namespace}/${object.metadata.name}`;

      describe(id, () => {
        const row = jobRow(hostRecord(object, undefined, jobDefinition.type));

        it('Status: the word kubectl prints', () => {
          expect(row.status?.word).toBe(cell(cells, 'Status'));
        });

        it('Completions: the text kubectl prints, succeeded over wanted, "of N" for a work queue that runs N at a time', () => {
          expect(field('completions').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'Completions'), mono: true });
        });

        it('Duration: kubectl\'s span, to the second for a Job that finished, and since its start for one that has not', () => {
          const printed = cell(cells, 'Duration');
          const shown = field('duration').display(row, now);

          if (printed === '') {
            // A Job that never started (suspended) has no duration: kubectl prints nothing, the list a dash.
            expect(shown.kind).toBe('none');
            return;
          }

          const seconds = kubectlSeconds(printed);
          if (row.finishedAt !== undefined) {
            expect(shown.kind).toBe('text');
            expect((row.finishedAt - row.startedAt!) / 1000).toBe(seconds);
          } else {
            // Still counting, a Failed Job too: kubectl and the mock both read time since the start for a Job that has no completion time.
            expect(shown.kind).toBe('elapsed');
            expect(Math.abs((now - row.startedAt!) / 1000 - seconds)).toBeLessThanOrEqual(1);
          }
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const age = formatAge(row.createdAt!, now).text;
          const [from, to] = ageWindow(age);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, a Job\'s name being one that can be generated', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(jobDefinition.list.identity.tail(row)).toBe(/-[a-z0-9]{1,10}$/.exec(row.name)?.[0].length ?? 0);
        });
      });
    }
  });
}

describe('the fixture covers the states the list has to show', () => {
  const rows = golden.captures.flatMap((capture) => capture.rows.map(({ object }) => jobRow(hostRecord(object, undefined, jobDefinition.type))));

  it('holds the four words of the list: Running, Complete, Failed and Suspended', () => {
    expect(new Set(rows.map((row) => row.status?.word))).toEqual(new Set(['Running', 'Complete', 'Failed', 'Suspended']));
  });

  it('counts the quick filters over the rows', () => {
    const counts = Object.fromEntries(jobDefinition.list.quickFilters.map((filter) => [filter.id, rows.filter(filter.test).length]));

    expect(counts).toEqual({ running: 1, complete: 3, failed: 2, suspended: 1 });
    expect(rows).toHaveLength(7);
  });
});
