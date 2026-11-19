import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, kubectlSeconds, type Capture } from '../testing';

import { daemonSetDefinition } from './definition';
import { daemonSetObject } from './object';
import { daemonSetRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the DaemonSet object and the cells the server printed for it, taken
// together (fixtures/daemonsets-table.json, made by hack/kinds-capture/capture.mjs on the slice fixture and extra-states.yaml). `kubectl get daemonsets -A` prints these cells:
// NAME DESIRED CURRENT READY UP-TO-DATE AVAILABLE NODE SELECTOR AGE. kubectl prints no state word for a DaemonSet, so the word is checked against the K61.3 rule applied to the counts
// of kubectl's own cells, and against the words written down below for each state the fixture holds.

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/daemonsets-table.json'), 'utf8')) as { captures: readonly Capture[] };

/** K61.3's rule over the counts kubectl printed: DESIRED, READY, UP-TO-DATE and AVAILABLE. */
function expectedWord(cells: readonly (string | number)[]): string {
  const [desired, , ready, updated, available] = cells.slice(1, 6).map(Number);
  if (desired === 0) {
    return 'Scaled to zero';
  }

  if (available === 0) {
    return 'Unavailable';
  }

  if (ready < desired) {
    return 'Partially ready';
  }

  return updated < desired ? 'Progressing' : 'Available';
}

const WORDS: Readonly<Record<string, string>> = {
  'kube-system/kindnet': 'Available',
  'kube-system/kube-proxy': 'Available',
  'monitoring/node-agent': 'Available',
  'states/bad-image': 'Unavailable', // one node, its Pod cannot start
  'states/no-nodes': 'Scaled to zero', // no node matches its selector: no Pod is wanted
};

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = `${object.metadata.namespace}/${object.metadata.name}`;

      describe(id, () => {
        const record = hostRecord(object, undefined, daemonSetDefinition.type);
        const row = daemonSetRow(record);
        const decoded = daemonSetObject(record);

        it('Desired, Ready and Up-to-date: the numbers kubectl prints', () => {
          expect(row.desired).toBe(Number(cell(cells, 'Desired')));
          expect(row.ready).toBe(Number(cell(cells, 'Ready')));
          expect(row.updated).toBe(Number(cell(cells, 'Up-to-date')));
        });

        it('Available: the number kubectl prints (an absent count is the API\'s zero), the one the state word reads beside the others', () => {
          expect(decoded.status?.numberAvailable ?? 0).toBe(Number(cell(cells, 'Available')));
        });

        it('Status: K61.3\'s word for the counts kubectl prints, and the word written down for this state', () => {
          expect(row.status?.word).toBe(expectedWord(cells));
          expect(row.status?.word).toBe(WORDS[id]);
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
  const rows = golden.captures.flatMap((capture) => capture.rows.map(({ object }) => daemonSetRow(hostRecord(object, undefined, daemonSetDefinition.type))));

  it('holds three of the six words (one node: a count between none and all is a unit test)', () => {
    expect(new Set(rows.map((row) => row.status?.word))).toEqual(new Set(['Available', 'Unavailable', 'Scaled to zero']));
  });

  it('counts the quick filters over the rows', () => {
    const counts = Object.fromEntries(daemonSetDefinition.list.quickFilters.map((filter) => [filter.id, rows.filter(filter.test).length]));

    expect(counts).toEqual({ available: 3, progressing: 0, partial: 0, unavailable: 1 });
  });
});
