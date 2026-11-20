import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { bytesText, formatAge } from '../fields';
import { quantityOf } from '../quantity';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture, type CapturedObject } from '../testing';

import { persistentVolumeClaimDefinition } from './definition';
import { persistentVolumeClaimRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the PersistentVolumeClaim object and the cells the server printed for it, taken together
// (fixtures/persistentvolumeclaims-table.json, made by hack/kinds-capture/capture.mjs on the cluster that more-kinds.sh and k2b2-kinds.yaml fill). `kubectl get persistentvolumeclaims -A` prints these cells:
// NAME STATUS VOLUME CAPACITY ACCESS MODES STORAGECLASS VOLUMEATTRIBUTESCLASS AGE VOLUMEMODE. The list shows the five of the mock: Status, Volume, Capacity, Storage class, Age.
// Presentation mappings, said where they happen below: kubectl's Capacity is a quantity (`1536Mi`) that the list says in the mock's units (`1.5 GiB`); kubectl prints the empty string for no volume and no
// class, the list a dash that says why. ONE recorded difference: a claim with no `status.capacity` (`claim-lost`) is `0` in kubectl, the zero Quantity, and a dash in the list.

type ClaimCapture = Omit<Capture, 'rows'> & {
  readonly rows: ReadonlyArray<{ readonly cells: Capture['rows'][number]['cells']; readonly object: CapturedObject & { readonly status?: { readonly capacity?: unknown }; readonly metadata: CapturedObject['metadata'] & { readonly deletionTimestamp?: string } } }>;
};

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/persistentvolumeclaims-table.json'), 'utf8')) as { captures: readonly ClaimCapture[] };

const field = (id: string) => persistentVolumeClaimDefinition.fields.find((candidate) => candidate.id === id)!;

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = persistentVolumeClaimRow(hostRecord(object, undefined, persistentVolumeClaimDefinition.type));

        it('Status: the word kubectl prints, with the role the table gives it', () => {
          expect(row.status?.word).toBe(cell(cells, 'Status'));
          expect(field('status').display(row, now)).toMatchObject({ kind: 'status', raw: cell(cells, 'Status'), label: cell(cells, 'Status') });
        });

        it('Volume: the name kubectl prints; the empty string kubectl prints for no volume is our dash', () => {
          const printed = cell(cells, 'Volume');

          if (printed === '') {
            expect(row.volume).toBeUndefined();
            expect(field('volume').display(row, now)).toEqual({ kind: 'none', reason: 'The claim is not bound to a volume.' });
          } else {
            expect(row.volume).toBe(printed);
            expect(field('volume').display(row, now)).toEqual({ kind: 'text', text: printed });
          }
        });

        it('Capacity: the quantity kubectl prints, in the mock\'s units (the mapping: `1536Mi` is `1.5 GiB`); for a claim with no capacity kubectl prints the zero Quantity and the list a dash', () => {
          const printed = cell(cells, 'Capacity');

          if (object.status?.capacity === undefined) {
            // The recorded difference: the object states no capacity (a Lost claim, a Pending one), kubectl prints `0`, and the list shows the dash, as the object says.
            expect(['', '0']).toContain(printed);
            expect(row.capacity).toBeUndefined();
            expect(field('capacity').display(row, now)).toEqual({ kind: 'none', reason: 'The claim has no capacity yet.' });
          } else {
            expect(row.capacity).toBe(quantityOf(printed));
            expect(field('capacity').display(row, now)).toEqual({ kind: 'text', text: bytesText(quantityOf(printed)!) });
          }
        });

        it('Storage class: the name kubectl prints; the empty string kubectl prints for no class is our dash', () => {
          const printed = cell(cells, 'StorageClass');

          if (printed === '') {
            expect(row.storageClass).toBeUndefined();
            expect(field('storageClass').display(row, now)).toEqual({ kind: 'none', reason: 'The claim names no storage class.' });
          } else {
            expect(row.storageClass).toBe(printed);
            expect(field('storageClass').display(row, now)).toEqual({ kind: 'text', text: printed });
          }
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name: the identity kubectl prints, with its namespace under it and no tail', () => {
          expect(row.name).toBe(cell(cells, 'Name'));
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(persistentVolumeClaimDefinition.list.identity.second(row)).toBe(object.metadata.namespace);
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show', () => {
  const captured = golden.captures.flatMap((capture) => capture.rows);
  const rows = captured.map(({ object }) => persistentVolumeClaimRow(hostRecord(object, undefined, persistentVolumeClaimDefinition.type)));
  const named = (name: string) => rows.find((row) => row.name === name)!;

  it('holds the four words, the claim that is being deleted among them', () => {
    expect(new Set(rows.map((row) => row.status?.word))).toEqual(new Set(['Bound', 'Pending', 'Lost', 'Terminating']));
    expect(named('held').status?.word).toBe('Terminating');
  });

  it('holds a claim being deleted whose phase is still Bound: the deletion timestamp says the word, as kubectl does', () => {
    const held = captured.find(({ object }) => object.metadata.name === 'held')!.object as { metadata: { deletionTimestamp?: string }; status?: { phase?: string } };

    expect(held.metadata.deletionTimestamp).toBeDefined();
    expect(held.status?.phase).toBe('Bound');
  });

  it('holds the Lost claim that names its volume and has no capacity, and a Pending claim with neither', () => {
    expect(named('claim-lost')).toMatchObject({ volume: 'pv-lost', capacity: undefined });
    expect(named('claim-pending')).toMatchObject({ volume: undefined, capacity: undefined });
  });

  it('holds a claim that asks for no class on purpose and one that has the default class', () => {
    const empty = captured.find(({ object }) => object.metadata.name === 'claim-no-class')!.object as { spec: { storageClassName?: string } };

    expect(empty.spec.storageClassName).toBe('');
    expect(named('claim-no-class').storageClass).toBeUndefined();
    expect(named('data').storageClass).toBe('standard');
  });

  it('counts the quick filters over the rows: a Terminating claim is in All and in no chip', () => {
    const counts = Object.fromEntries(persistentVolumeClaimDefinition.list.quickFilters.map((filter) => [filter.id, rows.filter(filter.test).length]));

    expect(counts).toEqual({ bound: 4, pending: 1, lost: 1 });
    expect(rows).toHaveLength(7);
  });
});
