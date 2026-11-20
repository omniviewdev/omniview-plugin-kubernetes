import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture, type CapturedObject } from '../testing';

import { horizontalPodAutoscalerDefinition } from './definition';
import { horizontalPodAutoscalerRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0, with a metrics-server), the HorizontalPodAutoscaler object (autoscaling/v2) and the
// cells the server printed for it, taken together (fixtures/horizontalpodautoscalers-table.json, made by hack/kinds-capture/capture.mjs on the cluster that k2b2-kinds.sh fills and metrics-server.yaml
// serves). `kubectl get hpa -A` prints these cells: NAME REFERENCE TARGETS MINPODS MAXPODS REPLICAS AGE. It prints no state, so the word of the list is checked against the conditions of the object, read
// here by hand and not by the code under test. kubectl writes a target as `cpu: 0%/50%` and what it cannot read as `<unknown>`; the list says `cpu 0%/50%` and `cpu —/80%`.

type Condition = { readonly type: string; readonly status: string; readonly reason?: string };

/** A capture whose objects are HorizontalPodAutoscalers: the part of the object the golden reads beside what every capture has. */
type AutoscalerCapture = Omit<Capture, 'rows'> & {
  readonly rows: ReadonlyArray<{
    readonly cells: Capture['rows'][number]['cells'];
    readonly object: CapturedObject & {
      readonly spec: { readonly metrics: ReadonlyArray<{ readonly type: string }> };
      readonly status: { readonly currentReplicas?: number; readonly conditions: readonly Condition[]; readonly currentMetrics: ReadonlyArray<{ readonly type: string }> | null };
    };
  }>;
};

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/horizontalpodautoscalers-table.json'), 'utf8')) as { captures: readonly AutoscalerCapture[] };

const field = (id: string) => horizontalPodAutoscalerDefinition.fields.find((candidate) => candidate.id === id)!;

/** The role of each word of the rule (K61.3). */
const ROLES: Readonly<Record<string, string>> = { 'Scaling active': 'healthy', Limited: 'attention', 'Unable to scale': 'error' };

/**
 * What a person reads in the conditions of an autoscaler, with none of the code of the list: it cannot scale when it cannot read its target or its metrics, it is held at a limit when it says so, and
 * it is scaling when it says so. It says nothing when the conditions say none of these.
 */
function reading(conditions: readonly Condition[]): string | undefined {
  const says = (type: string, status: string) => conditions.some((condition) => condition.type === type && condition.status === status);

  if (says('AbleToScale', 'False') || says('ScalingActive', 'False')) {
    return 'Unable to scale';
  }

  if (says('ScalingLimited', 'True')) {
    return 'Limited';
  }

  return says('ScalingActive', 'True') ? 'Scaling active' : undefined;
}

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = horizontalPodAutoscalerRow(hostRecord(object, undefined, horizontalPodAutoscalerDefinition.type));

        it('Status: the word the conditions of the object say, with the role of the table (kubectl prints no state)', () => {
          const word = reading(object.status.conditions);

          expect(row.status?.word).toBe(word);
          expect(field('status').display(row, now)).toEqual(word === undefined ? { kind: 'none', reason: 'The autoscaler has not reported yet.' } : { kind: 'status', raw: word, label: word, role: ROLES[word] });
        });

        it('Reference: the reference kubectl prints', () => {
          expect(row.reference).toBe(cell(cells, 'Reference'));
          expect(field('reference').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'Reference') });
        });

        it('Targets: the targets kubectl prints, in the words of the list: the colon after the resource goes, and what kubectl cannot read, <unknown>, is the dash', () => {
          // The presentation mapping (the mock's `hpaTargets`): kubectl's `cpu: 0%/50%, memory: 304Ki/100Mi` is `cpu 0%/50%, memory 304Ki/100Mi`, and `cpu: <unknown>/80%` is `cpu —/80%`.
          const expected = cell(cells, 'Targets').split(', ').map((piece) => piece.replace(': ', ' ').replace('<unknown>', '—')).join(', ');

          expect(field('targets').display(row, now)).toEqual({ kind: 'text', text: expected });
        });

        it('Replicas: the number kubectl prints; where the object states none, a dash', () => {
          const stated = object.status.currentReplicas;

          // kubectl reads a Go number and prints 0 for a status that holds no `currentReplicas` (the API leaves a zero out, as the `zero` autoscaler's status shows). The list says what the object holds,
          // and where it holds nothing it does not make 0 up: the dash that says why.
          expect(field('replicas').display(row, now)).toEqual(stated === undefined ? { kind: 'none', reason: 'The autoscaler reports no current replicas.' } : { kind: 'text', text: cell(cells, 'Replicas'), mono: true });
          expect(row.replicas).toBe(stated);
          if (stated === undefined) {
            expect(cell(cells, 'Replicas')).toBe('0');
          }
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: an autoscaler\'s name is not generated', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show', () => {
  const captured = golden.captures.flatMap((capture) =>
    capture.rows.map(({ cells, object }) => ({ cells, columns: capture.columns, object, row: horizontalPodAutoscalerRow(hostRecord(object, undefined, horizontalPodAutoscalerDefinition.type)) })));
  const rows = new Map(captured.map((entry) => [idOf(entry.object), entry]));
  const printed = (entry: (typeof captured)[number], name: string) => String(entry.cells[entry.columns.indexOf(name)]);

  it('holds each word of the rule: two autoscalers held at their minimum (Limited), one that scales (Scaling active), and two that cannot read their metrics or have no Pod to measure (Unable to scale)', () => {
    expect(Object.fromEntries(captured.map(({ object, row }) => [object.metadata.name, row.status?.word]))).toEqual({
      floor: 'Limited',
      multi: 'Scaling active',
      'no-request': 'Unable to scale',
      // `web` was written to scale, and the controller found it at its minimum with no load to measure: ScalingLimited came True (TooFewReplicas) in the minute before the capture.
      web: 'Limited',
      zero: 'Unable to scale',
    });
    expect(new Set(captured.map(({ row }) => row.status?.word))).toEqual(new Set(['Scaling active', 'Limited', 'Unable to scale']));
  });

  it('says in its conditions why each word holds', () => {
    const conditionsOf = (name: string) => Object.fromEntries((rows.get(`autoscale/${name}`)?.object.status.conditions ?? []).map((condition) => [condition.type, `${condition.status} ${condition.reason}`]));

    expect(conditionsOf('floor')).toMatchObject({ ScalingActive: 'True ValidMetricFound', ScalingLimited: 'True TooFewReplicas' });
    expect(conditionsOf('web')).toMatchObject({ ScalingActive: 'True ValidMetricFound', ScalingLimited: 'True TooFewReplicas' });
    expect(conditionsOf('multi')).toMatchObject({ ScalingActive: 'True ValidMetricFound', ScalingLimited: 'False DesiredWithinRange' });
    expect(conditionsOf('no-request')).toMatchObject({ AbleToScale: 'True SucceededGetScale', ScalingActive: 'False FailedGetResourceMetric' });
    expect(conditionsOf('zero')).toMatchObject({ AbleToScale: 'True SucceededGetScale', ScalingActive: 'False ScalingDisabled' });
  });

  it('holds metrics that metrics-server reads: a utilization and an average value, and a reading of each', () => {
    expect(rows.get('autoscale/web')?.row.targets).toEqual(['cpu 0%/50%']);
    expect(rows.get('autoscale/floor')?.row.targets).toEqual(['cpu 0%/70%']);
    expect(rows.get('autoscale/multi')?.row.targets).toEqual(['cpu 0%/50%', 'memory 304Ki/100Mi']);
    for (const name of ['web', 'floor', 'multi']) {
      expect(printed(rows.get(`autoscale/${name}`)!, 'Targets'), name).not.toContain('<unknown>');
    }
  });

  it('holds metrics that cannot be read: the status holds an empty reading, or none, and kubectl prints <unknown>', () => {
    const noRequest = rows.get('autoscale/no-request')!;
    expect(noRequest.object.status.currentMetrics).toEqual([{ type: '' }]);
    expect(printed(noRequest, 'Targets')).toBe('cpu: <unknown>/80%');
    expect(noRequest.row.targets).toEqual(['cpu —/80%']);

    const zero = rows.get('autoscale/zero')!;
    expect(zero.object.status.currentMetrics).toBeNull();
    expect(printed(zero, 'Targets')).toBe('cpu: <unknown>/50%');
    expect(zero.row.targets).toEqual(['cpu —/50%']);
  });

  it('holds an autoscaler whose status states no current replicas, where kubectl prints 0: the one whose target has no Pod', () => {
    const zero = rows.get('autoscale/zero')!;
    expect(zero.object.status.currentReplicas).toBeUndefined();
    expect(printed(zero, 'Replicas')).toBe('0');
    expect(zero.row.replicas).toBeUndefined();
    expect(captured.filter(({ row }) => row.replicas === undefined)).toHaveLength(1);
  });

  it('holds only resource metrics: the other types of metric are tried by the unit tests, not by this cluster', () => {
    for (const { object } of captured) {
      expect(object.spec.metrics.every((metric) => metric.type === 'Resource')).toBe(true);
    }

    expect(rows.size).toBe(5);
  });
});
