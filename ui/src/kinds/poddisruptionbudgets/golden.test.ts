import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture, type CapturedObject } from '../testing';

import { podDisruptionBudgetDefinition } from './definition';
import { podDisruptionBudgetRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the PodDisruptionBudget object and the cells the server printed for it, taken together
// (fixtures/poddisruptionbudgets-table.json, made by hack/kinds-capture/capture.mjs on the cluster that k2b2-kinds.sh fills). `kubectl get pdb -A` prints these cells: NAME MIN AVAILABLE MAX UNAVAILABLE
// ALLOWED DISRUPTIONS AGE. The list draws only the number of disruptions the budget allows (the mock's default set): Min available and Max unavailable are its wide set, which the list contract does not
// have, so kubectl's two columns are not compared with a cell. They are in the covers block below, as what the object says.

/** A capture whose objects are PodDisruptionBudgets: the part of the object the golden reads beside what every capture has. */
type BudgetCapture = Omit<Capture, 'rows'> & {
  readonly rows: ReadonlyArray<{
    readonly cells: Capture['rows'][number]['cells'];
    readonly object: CapturedObject & {
      readonly spec: { readonly minAvailable?: number | string; readonly maxUnavailable?: number | string };
      readonly status: { readonly disruptionsAllowed: number; readonly expectedPods: number };
    };
  }>;
};

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/poddisruptionbudgets-table.json'), 'utf8')) as { captures: readonly BudgetCapture[] };

const field = (id: string) => podDisruptionBudgetDefinition.fields.find((candidate) => candidate.id === id)!;

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = podDisruptionBudgetRow(hostRecord(object, undefined, podDisruptionBudgetDefinition.type));

        it('Allowed disruptions: the number kubectl prints, in the code face', () => {
          expect(row.allowed).toBe(Number(cell(cells, 'Allowed Disruptions')));
          expect(field('allowed').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'Allowed Disruptions'), mono: true });
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: a PodDisruptionBudget\'s name is not generated', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show', () => {
  // Each object, what kubectl printed for it under MIN AVAILABLE and MAX UNAVAILABLE, and its row.
  const captured = golden.captures.flatMap((capture) =>
    capture.rows.map(({ cells, object }) => {
      const printed = (name: string) => String(cells[capture.columns.indexOf(name)]);
      return { object, kubectl: { min: printed('Min Available'), max: printed('Max Unavailable') }, row: podDisruptionBudgetRow(hostRecord(object, undefined, podDisruptionBudgetDefinition.type)) };
    }));
  const rows = new Map(captured.map((entry) => [idOf(entry.object), entry]));

  it('holds a budget that allows none (its Pods are all it needs), one that allows one (a share of the Pods may go), and one that cannot be met (it needs more Pods than there are)', () => {
    const web = rows.get('autoscale/web')!;
    expect(web.object.spec).toEqual({ minAvailable: 1, selector: { matchLabels: { app: 'web' } } });
    expect(web.kubectl).toEqual({ min: '1', max: 'N/A' });
    expect(web.row.allowed).toBe(0);

    const floor = rows.get('autoscale/floor')!;
    expect(floor.object.spec.maxUnavailable).toBe('50%');
    expect(floor.kubectl).toEqual({ min: 'N/A', max: '50%' });
    expect(floor.row.allowed).toBe(1);

    const strict = rows.get('autoscale/strict')!;
    expect(strict.object.spec.minAvailable).toBe(5);
    expect(strict.object.status.expectedPods).toBe(1);
    expect(strict.kubectl).toEqual({ min: '5', max: 'N/A' });
    expect(strict.row.allowed).toBe(0);
    expect(rows.size).toBe(3);
  });
});
