import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, kubectlSeconds, type Capture } from '../testing';

import { deploymentDefinition } from './definition';
import { deploymentObject } from './object';
import { deploymentRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the Deployment object and the cells the server printed for it, taken
// together (fixtures/deployments-table.json, made by hack/kinds-capture/capture.mjs on the slice fixture and extra-states.yaml). `kubectl get deployments -A` prints these cells:
// NAME READY UP-TO-DATE AVAILABLE AGE. kubectl prints no state word for a Deployment, so the word is checked two ways: against the K61.3 rule applied to the counts of kubectl's own cells,
// and against the words written down below for each state the fixture holds.

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/deployments-table.json'), 'utf8')) as { captures: readonly Capture[] };

/** The rollout of `states/paused` was paused with `kubectl rollout pause`: `spec.paused` is in no printed cell. */
const PAUSED = new Set(['states/paused']);

/** K61.3's rule over the counts kubectl printed: READY is ready/desired, then UP-TO-DATE and AVAILABLE. */
function expectedWord(id: string, cells: readonly (string | number)[]): string {
  const [ready, desired] = String(cells[1]).split('/').map(Number);
  const updated = Number(cells[2]);
  const available = Number(cells[3]);
  if (PAUSED.has(id)) {
    return 'Paused';
  }

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

/** The state of each Deployment of the fixture, written down by what its cluster does (extra-states.yaml says how each was made). */
const WORDS: Readonly<Record<string, string>> = {
  'checkout/cart-api': 'Available',
  'checkout/payment-gateway': 'Available',
  'kube-system/coredns': 'Available',
  'local-path-storage/local-path-provisioner': 'Available',
  'monitoring/alertmanager': 'Available',
  'states/scaled-zero': 'Scaled to zero',
  'states/bad-image': 'Unavailable', // two wanted, no Pod can start
  'states/half-ready': 'Partially ready', // two wanted, the second Pod cannot be placed beside the first
  'states/stuck-rollout': 'Progressing', // two ready on the old template, one new Pod that cannot start
  'states/paused': 'Paused',
};

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = `${object.metadata.namespace}/${object.metadata.name}`;

      describe(id, () => {
        const record = hostRecord(object, undefined, deploymentDefinition.type);
        const row = deploymentRow(record);
        const decoded = deploymentObject(record);

        it('Ready: the number kubectl prints, ready over desired', () => {
          expect(row.ready === undefined ? undefined : `${row.ready.ready}/${row.ready.total}`).toBe(cell(cells, 'Ready'));
        });

        it('Up-to-date and Available: the numbers kubectl prints (an absent count is the API\'s zero)', () => {
          expect(row.updated).toBe(Number(cell(cells, 'Up-to-date')));
          expect(decoded.status?.availableReplicas ?? 0).toBe(Number(cell(cells, 'Available')));
        });

        it('Status: K61.3\'s word for the counts kubectl prints, and the word written down for this state', () => {
          expect(row.status?.word).toBe(expectedWord(id, cells));
          expect(row.status?.word).toBe(WORDS[id]);
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const age = formatAge(row.createdAt!, now).text;
          const [from, to] = ageWindow(age);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: a Deployment\'s name is not generated', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers every state the list has to show', () => {
  const rows = golden.captures.flatMap((capture) => capture.rows.map(({ object }) => deploymentRow(hostRecord(object, undefined, deploymentDefinition.type))));

  it('holds each state word the rule can say', () => {
    expect(new Set(rows.map((row) => row.status?.word))).toEqual(new Set(['Available', 'Scaled to zero', 'Unavailable', 'Partially ready', 'Progressing', 'Paused']));
  });

  it('counts the quick filters over the rows: one in each filter but Available, which has the five that are well; Scaled to zero and Paused are in All and in no filter', () => {
    const counts = Object.fromEntries(deploymentDefinition.list.quickFilters.map((filter) => [filter.id, rows.filter(filter.test).length]));

    expect(counts).toEqual({ available: 5, progressing: 1, partial: 1, unavailable: 1 });
    expect(rows).toHaveLength(10);
  });
});
