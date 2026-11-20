import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture } from '../testing';

import { nodeDefinition } from './definition';
import { nodeRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the Node object and the cells the server printed for it, taken together
// (fixtures/nodes-table.json, made by hack/kinds-capture/capture.mjs). `kubectl get nodes` prints these cells: NAME STATUS ROLES AGE VERSION, and with -o wide an INTERNAL-IP. The file holds three captures
// of the cluster's one Node: as it is, cordoned (`kubectl cordon`: kubectl prints `Ready,SchedulingDisabled`), and with its kubelet stopped (`systemctl stop kubelet` in the node: the Ready condition
// goes Unknown, and kubectl prints `NotReady`). kubectl prints the cordon as a second word after a comma; the list has one word for it (K61.1: Scheduling disabled).

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/nodes-table.json'), 'utf8')) as { captures: readonly Capture[] };

const field = (id: string) => nodeDefinition.fields.find((candidate) => candidate.id === id)!;

/** The word of the list for what kubectl printed: the Ready word, or the word for a cordon when the Node is Ready. */
function expectedWord(printed: string): string {
  const [word = '', cordon] = printed.split(',');
  return cordon === 'SchedulingDisabled' && word === 'Ready' ? 'Scheduling disabled' : word;
}

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = nodeRow(hostRecord(object, undefined, nodeDefinition.type));

        it('Status: the word kubectl prints, with the cordon as the word of its own', () => {
          expect(row.status?.word).toBe(expectedWord(cell(cells, 'Status')));
        });

        it('Version: the kubelet version kubectl prints, three numbers in the cell and the whole in the tip', () => {
          const printed = cell(cells, 'Version');
          expect(row.version).toBe(printed);
          expect(field('version').display(row, now)).toMatchObject({ kind: 'text', text: /^v?\d+\.\d+\.\d+/.exec(printed)?.[0] });
        });

        it('The address under the name: the Internal-IP kubectl prints with -o wide', () => {
          expect(nodeDefinition.list.identity.second(row)).toBe(cell(cells, 'Internal-IP'));
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name: the identity kubectl prints, in no namespace and with no tail', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(object.metadata.namespace).toBeUndefined();
          expect(row.namespace).toBe('');
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers the states the list has to show', () => {
  it('holds the three captures, each with its own word: Ready, Scheduling disabled and NotReady', () => {
    const words = golden.captures.map((capture) => capture.rows.map(({ object }) => nodeRow(hostRecord(object, undefined, nodeDefinition.type)).status?.word));
    expect(words).toEqual([['Ready'], ['Scheduling disabled'], ['NotReady']]);
  });

  it('counts the quick filters over the rows of each capture', () => {
    const counts = golden.captures.map((capture) => {
      const rows = capture.rows.map(({ object }) => nodeRow(hostRecord(object, undefined, nodeDefinition.type)));
      return Object.fromEntries(nodeDefinition.list.quickFilters.map((filter) => [filter.id, rows.filter(filter.test).length]));
    });

    expect(counts).toEqual([
      { ready: 1, notready: 0, cordoned: 0 },
      { ready: 0, notready: 0, cordoned: 1 },
      { ready: 0, notready: 1, cordoned: 0 },
    ]);
  });
});
