import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { bytesText, formatAge } from '../fields';
import { quantityOf } from '../quantity';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture } from '../testing';

import { persistentVolumeDefinition } from './definition';
import { persistentVolumeRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the PersistentVolume object and the cells the server printed for it, taken together
// (fixtures/persistentvolumes-table.json, made by hack/kinds-capture/capture.mjs on the cluster that more-kinds.sh and k2b2-kinds.yaml fill). `kubectl get persistentvolumes` prints these cells: NAME
// CAPACITY ACCESS MODES RECLAIM POLICY STATUS CLAIM STORAGECLASS VOLUMEATTRIBUTESCLASS REASON AGE VOLUMEMODE. The list shows the five of the mock: Capacity, Status, Claim, Storage class, Age.
// Presentation mappings, said where they happen below: kubectl's Capacity is a quantity (`1536Mi`) that the list says in the mock's units (`1.5 GiB`); kubectl prints the empty string for no claim and no
// class, the list a dash that says why. A PersistentVolume lives in no namespace, so the object has none and the row has none.

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/persistentvolumes-table.json'), 'utf8')) as { captures: readonly Capture[] };

const field = (id: string) => persistentVolumeDefinition.fields.find((candidate) => candidate.id === id)!;

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = persistentVolumeRow(hostRecord(object, undefined, persistentVolumeDefinition.type));

        it('Capacity: the quantity kubectl prints, in the mock\'s units (the mapping: `1536Mi` is `1.5 GiB`)', () => {
          const printed = quantityOf(cell(cells, 'Capacity'));

          expect(printed).toBeDefined();
          expect(row.capacity).toBe(printed);
          expect(field('capacity').display(row, now)).toEqual({ kind: 'text', text: bytesText(printed!) });
        });

        it('Status: the word kubectl prints, with the role the table gives it', () => {
          expect(row.status?.word).toBe(cell(cells, 'Status'));
          expect(field('status').display(row, now)).toMatchObject({ kind: 'status', raw: cell(cells, 'Status'), label: cell(cells, 'Status') });
        });

        it('Claim: namespace/name as kubectl prints it; the empty string kubectl prints for no claim is our dash', () => {
          const printed = cell(cells, 'Claim');

          if (printed === '') {
            expect(row.claim).toBeUndefined();
            expect(field('claim').display(row, now)).toEqual({ kind: 'none', reason: 'The volume is not claimed.' });
          } else {
            expect(row.claim).toBe(printed);
            expect(field('claim').display(row, now)).toEqual({ kind: 'text', text: printed });
          }
        });

        it('Storage class: the name kubectl prints; the empty string kubectl prints for no class is our dash', () => {
          const printed = cell(cells, 'StorageClass');

          if (printed === '') {
            expect(row.storageClass).toBeUndefined();
            expect(field('storageClass').display(row, now)).toEqual({ kind: 'none', reason: 'The volume names no storage class.' });
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

        it('Name: the identity kubectl prints, in no namespace and with no second line and no tail', () => {
          expect(row.name).toBe(cell(cells, 'Name'));
          expect(row.name).toBe(object.metadata.name);
          expect(object.metadata.namespace).toBeUndefined();
          expect(row.namespace).toBe('');
          expect(persistentVolumeDefinition.list.identity.second(row)).toBeNull();
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show', () => {
  const captured = golden.captures.flatMap((capture) => capture.rows);
  const rows = captured.map(({ object }) => persistentVolumeRow(hostRecord(object, undefined, persistentVolumeDefinition.type)));
  const named = (name: string) => rows.find((row) => row.name === name)!;

  it('holds the five words, the volume that is being deleted among them', () => {
    expect(new Set(rows.map((row) => row.status?.word))).toEqual(new Set(['Available', 'Bound', 'Released', 'Failed', 'Terminating']));
    expect(named('pv-terminating').status?.word).toBe('Terminating');
  });

  it('holds a volume being deleted whose phase is still Bound: the deletion timestamp says the word, as kubectl does', () => {
    const object = captured.find(({ object: candidate }) => candidate.metadata.name === 'pv-terminating')!.object as { metadata: { deletionTimestamp?: string }; status?: { phase?: string } };

    expect(object.metadata.deletionTimestamp).toBeDefined();
    expect(object.status?.phase).toBe('Bound');
  });

  it('holds volumes with and without a claim, and with and without a class', () => {
    expect(rows.some((row) => row.claim !== undefined)).toBe(true);
    expect(rows.some((row) => row.claim === undefined)).toBe(true);
    expect(rows.some((row) => row.storageClass !== undefined)).toBe(true);
    expect(named('pv-no-class').storageClass).toBeUndefined();
    expect(named('pv-no-class').claim).toBe('storage/claim-no-class');
  });

  it('holds the sizes the list says in each unit: 1 GiB, 1.5 GiB, 2 TiB, 500 MiB and 10 MiB', () => {
    const texts = rows.map((row) => bytesText(row.capacity!));

    for (const size of ['1 GiB', '1.5 GiB', '2 TiB', '500 MiB', '10 MiB']) {
      expect(texts).toContain(size);
    }
  });

  it('counts the quick filters over the rows: a Terminating volume is in All and in no chip', () => {
    const counts = Object.fromEntries(persistentVolumeDefinition.list.quickFilters.map((filter) => [filter.id, rows.filter(filter.test).length]));

    expect(counts).toEqual({ available: 3, bound: 4, released: 1, failed: 1 });
    expect(rows).toHaveLength(10);
  });
});
