import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, kubectlSeconds, type Capture } from '../testing';

import { statefulSetDefinition } from './definition';
import { statefulSetRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the StatefulSet object and the cells the server printed for it, taken
// together (fixtures/statefulsets-table.json, made by hack/kinds-capture/capture.mjs on the slice fixture and extra-states.yaml). `kubectl get statefulsets -A` prints these cells: NAME READY AGE.
// kubectl prints no state word and no Service for a StatefulSet, so the word is checked against the K61.3 rule applied to the count of kubectl's own READY cell, and against the words
// written down below for each state the fixture holds.

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/statefulsets-table.json'), 'utf8')) as { captures: readonly Capture[] };

/** K61.3's rule over the count kubectl printed (READY is ready/desired). A StatefulSet's printed cells say no more, so a rollout in progress or a pause is not in them. */
function expectedWord(cells: readonly (string | number)[]): string {
  const [ready, desired] = String(cells[1]).split('/').map(Number);
  if (desired === 0) {
    return 'Scaled to zero';
  }

  if (ready === 0) {
    return 'Unavailable';
  }

  return ready < desired ? 'Partially ready' : 'Available';
}

const WORDS: Readonly<Record<string, string>> = {
  'checkout/cart-cache': 'Available',
  'states/scaled-zero': 'Scaled to zero',
  'states/bad-image': 'Unavailable', // its one Pod cannot start
  'states/half-ready': 'Partially ready', // two wanted at once, the second Pod cannot be placed beside the first
};

/** The governing Service each StatefulSet of the fixture names in `spec.serviceName`: the plain text of the Service column. */
const SERVICES: Readonly<Record<string, string>> = {
  'checkout/cart-cache': 'cart-cache',
  'states/scaled-zero': 'scaled-zero',
  'states/bad-image': 'bad-image',
  'states/half-ready': 'half-ready',
};

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = `${object.metadata.namespace}/${object.metadata.name}`;

      describe(id, () => {
        const row = statefulSetRow(hostRecord(object, undefined, statefulSetDefinition.type));

        it('Ready: the number kubectl prints, ready over desired', () => {
          expect(row.ready === undefined ? undefined : `${row.ready.ready}/${row.ready.total}`).toBe(cell(cells, 'Ready'));
        });

        it('Status: K61.3\'s word for the count kubectl prints, and the word written down for this state', () => {
          expect(row.status?.word).toBe(expectedWord(cells));
          expect(row.status?.word).toBe(WORDS[id]);
        });

        it('Service: the governing Service the object names', () => {
          expect(row.service).toBe(SERVICES[id]);
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const age = formatAge(row.createdAt!, now).text;
          const [from, to] = ageWindow(age);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
        });
      });
    }
  });
}

describe('the fixture covers the states the list has to show', () => {
  const rows = golden.captures.flatMap((capture) => capture.rows.map(({ object }) => statefulSetRow(hostRecord(object, undefined, statefulSetDefinition.type))));

  it('holds four of the six words (a StatefulSet has no pause, and a rollout in progress is a unit test)', () => {
    expect(new Set(rows.map((row) => row.status?.word))).toEqual(new Set(['Available', 'Scaled to zero', 'Unavailable', 'Partially ready']));
  });

  it('counts the quick filters over the rows', () => {
    const counts = Object.fromEntries(statefulSetDefinition.list.quickFilters.map((filter) => [filter.id, rows.filter(filter.test).length]));

    expect(counts).toEqual({ available: 1, progressing: 0, partial: 1, unavailable: 1 });
  });
});
