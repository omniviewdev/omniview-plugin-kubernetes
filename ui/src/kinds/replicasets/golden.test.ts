import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture, type CapturedObject } from '../testing';

import { replicaSetDefinition } from './definition';
import { replicaSetRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the ReplicaSet object and the cells the server printed for it, taken together
// (fixtures/replicasets-table.json, made by hack/kinds-capture/capture.mjs on the slice fixture, extra-states.yaml and more-kinds.yaml). `kubectl get replicasets -A` prints these cells:
// NAME DESIRED CURRENT READY AGE. kubectl prints no state word for a ReplicaSet, so the word is checked two ways: against the K61.3 rule applied to the counts of kubectl's own cells, and
// against the words written down below for each state the fixture holds.

/** A capture whose objects are ReplicaSets: the count the status holds that kubectl does not print, beside what every capture has. */
type ReplicaSetCapture = Omit<Capture, 'rows'> & { readonly rows: ReadonlyArray<{ readonly cells: Capture['rows'][number]['cells']; readonly object: CapturedObject & { readonly status?: { readonly availableReplicas?: number } } }> };

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/replicasets-table.json'), 'utf8')) as { captures: readonly ReplicaSetCapture[] };

/**
 * K61.3's rule over the counts kubectl printed (DESIRED and READY) and the count it does not print, AVAILABLE, which the API omits when it is zero: the object's own, not ready read as available (the
 * two differ for replicas that are ready and not yet available, `minReadySeconds`).
 */
function expectedWord(cells: readonly (string | number)[], available: number): string {
  const desired = Number(cells[1]);
  const ready = Number(cells[3]);
  if (desired === 0) {
    return 'Scaled to zero';
  }

  if (available === 0) {
    return 'Unavailable';
  }

  return ready < desired ? 'Partially ready' : 'Ready';
}

describe('the oracle\'s own rule', () => {
  it('says Unavailable for replicas that are ready and not yet available, which the printed counts alone cannot tell from Ready', () => {
    expect(expectedWord(['x', 2, 2, 2, '1m'], 0)).toBe('Unavailable');
    expect(expectedWord(['x', 2, 2, 2, '1m'], 2)).toBe('Ready');
    expect(expectedWord(['x', 2, 2, 1, '1m'], 1)).toBe('Partially ready');
    expect(expectedWord(['x', 0, 0, 0, '1m'], 0)).toBe('Scaled to zero');
  });
});

/** The state of each ReplicaSet of the fixture, written down by what its cluster does (extra-states.yaml and more-kinds.yaml say how each was made). */
const WORDS: Readonly<Record<string, string>> = {
  'checkout/cart-api-86bf766589': 'Ready',
  'checkout/payment-gateway-6f45c7c7cd': 'Ready',
  'kube-system/coredns-7d764666f9': 'Ready',
  'local-path-storage/local-path-provisioner-67b8995b4b': 'Ready',
  'monitoring/alertmanager-5d5bcf5596': 'Ready',
  'more/bad-image': 'Unavailable', // one wanted, its Pod cannot start
  'more/half-ready': 'Partially ready', // two wanted, the second Pod cannot be placed beside the first
  'more/rolled-678b45b6cc': 'Scaled to zero', // the template of the first rollout, kept by its Deployment for a rollback
  'more/rolled-d5584bbdf': 'Ready',
  'more/scaled-zero': 'Scaled to zero',
  'more/standalone': 'Ready',
  'states/bad-image-575c47bcbd': 'Unavailable',
  'states/half-ready-59745dcbc': 'Partially ready',
  'states/paused-599855f757': 'Ready',
  'states/scaled-zero-6487d54744': 'Scaled to zero',
  'states/stuck-rollout-5475cf8785': 'Unavailable', // the new template of a rollout that cannot finish: its one Pod cannot start
  'states/stuck-rollout-78759bfd6c': 'Ready', // the old template, still serving
};

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = replicaSetRow(hostRecord(object, undefined, replicaSetDefinition.type));

        it('Desired, Current and Ready: the numbers kubectl prints', () => {
          expect([row.desired, row.current, row.ready]).toEqual([Number(cell(cells, 'Desired')), Number(cell(cells, 'Current')), Number(cell(cells, 'Ready'))]);
        });

        it('Status: K61.3\'s word for the counts kubectl prints, and the word written down for this state', () => {
          expect(row.status?.word).toBe(expectedWord(cells, object.status?.availableReplicas ?? 0));
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

        it('Name and namespace: the identity kubectl prints, a ReplicaSet\'s name being one that is generated', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(replicaSetDefinition.list.identity.tail(row)).toBe(/-[a-z0-9]{1,10}$/.exec(row.name)?.[0].length ?? 0);
        });
      });
    }
  });
}

describe('the fixture covers every state the list has to show', () => {
  const rows = golden.captures.flatMap((capture) => capture.rows.map(({ object }) => replicaSetRow(hostRecord(object, undefined, replicaSetDefinition.type))));

  it('holds each state word the rule can say', () => {
    expect(new Set(rows.map((row) => row.status?.word))).toEqual(new Set(['Ready', 'Scaled to zero', 'Unavailable', 'Partially ready']));
    expect(rows).toHaveLength(17);
  });

  it('holds a ReplicaSet no Deployment made, and one a Deployment left with no replica', () => {
    const owners = Object.fromEntries(golden.captures.flatMap((capture) => capture.rows.map(({ object }) => [idOf(object), object.metadata.ownerReferences?.[0]?.kind])));
    expect(owners['more/standalone']).toBeUndefined();
    expect(owners['more/rolled-678b45b6cc']).toBe('Deployment');
  });
});
