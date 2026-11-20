import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture } from '../testing';

import { cronJobDefinition } from './definition';
import { cronJobRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the CronJob object and the cells the server printed for it, taken together
// (fixtures/cronjobs-table.json, made by hack/kinds-capture/capture.mjs on the cluster that more-kinds.sh fills). `kubectl get cronjobs -A` prints these cells: NAME SCHEDULE TIMEZONE SUSPEND
// ACTIVE LAST SCHEDULE AGE. kubectl prints no state word for a CronJob: the mock's word is its SUSPEND cell in the user's words (Suspended for True, Active for False).

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/cronjobs-table.json'), 'utf8')) as { captures: readonly Capture[] };

const field = (id: string) => cronJobDefinition.fields.find((candidate) => candidate.id === id)!;

/** The state of each CronJob of the fixture, written down by what more-kinds.sh makes of it. */
const WORDS: Readonly<Record<string, string>> = {
  'more/forbid': 'Active', // runs every minute, and its Job never ends: one Job is active
  'more/done': 'Suspended', // ran once and was suspended after its Job finished: a last schedule and no active Job
  'more/never': 'Active', // a schedule that has not come: no last schedule
  'more/suspended': 'Suspended', // suspended from the start
};

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = cronJobRow(hostRecord(object, undefined, cronJobDefinition.type));

        it('Schedule: the text kubectl prints', () => {
          expect(field('schedule').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'Schedule') });
        });

        it('Status: the word of kubectl\'s SUSPEND, and the word written down for this state', () => {
          expect(row.status?.word).toBe(cell(cells, 'Suspend') === 'True' ? 'Suspended' : 'Active');
          expect(row.status?.word).toBe(WORDS[id]);
        });

        it('Active: the number of Jobs kubectl prints', () => {
          expect(row.active).toBe(Number(cell(cells, 'Active')));
          expect(field('active').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'Active'), mono: true });
        });

        it('Last schedule: the span its cell says stands for kubectl\'s, and a CronJob that has not run says <none> where the list has a dash', () => {
          const printed = cell(cells, 'Last Schedule');
          const shown = field('lastSchedule').display(row, now);

          if (printed === '<none>') {
            expect(shown.kind).toBe('none');
            return;
          }

          if (shown.kind !== 'age') {
            throw new Error(`the Last schedule cell is a ${shown.kind}`);
          }

          const [from, to] = ageWindow(shown.text);
          const seconds = kubectlSeconds(printed);
          expect(seconds).toBeGreaterThanOrEqual(from - 1);
          expect(seconds).toBeLessThan(to + 1);
        });

        it('Age: the span its cell says stands for kubectl\'s', () => {
          const shown = field('age').display(row, now);
          if (shown.kind !== 'age') {
            throw new Error(`the Age cell is a ${shown.kind}`);
          }

          const [from, to] = ageWindow(shown.text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: a CronJob\'s name is not generated', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers the states the list has to show', () => {
  const rows = golden.captures.flatMap((capture) => capture.rows.map(({ object }) => cronJobRow(hostRecord(object, undefined, cronJobDefinition.type))));

  it('holds both words, a CronJob that has run and one that has not, and one with a Job running', () => {
    expect(new Set(rows.map((row) => row.status?.word))).toEqual(new Set(['Active', 'Suspended']));
    expect(rows.filter((row) => row.lastScheduleAt === undefined)).toHaveLength(2);
    expect(rows.filter((row) => row.active === 1)).toHaveLength(1);
  });

  it('counts the quick filters over the rows', () => {
    const counts = Object.fromEntries(cronJobDefinition.list.quickFilters.map((filter) => [filter.id, rows.filter(filter.test).length]));

    expect(counts).toEqual({ active: 2, suspended: 2 });
    expect(rows).toHaveLength(4);
  });
});
