import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture } from '../testing';

import { storageClassDefinition } from './definition';
import { storageClassRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the StorageClass object and the cells the server printed for it, taken together
// (fixtures/storageclasses-table.json, made by hack/kinds-capture/capture.mjs on the cluster that more-kinds.sh and k2b2-kinds.yaml fill). `kubectl get storageclasses` prints these cells: NAME PROVISIONER
// RECLAIMPOLICY VOLUMEBINDINGMODE ALLOWVOLUMEEXPANSION AGE. Presentation mappings, said where they happen below: kubectl writes the default class as `standard (default)` (the name and a suffix from the
// annotation `storageclass.kubernetes.io/is-default-class`), the list shows the name `standard` (the annotation is the mock's `Default` column of the Columns chooser, not drawn); kubectl prints
// the boolean `true` or `false`, the list `Yes` or `No`.

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/storageclasses-table.json'), 'utf8')) as { captures: readonly Capture[] };

const field = (id: string) => storageClassDefinition.fields.find((candidate) => candidate.id === id)!;

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = storageClassRow(hostRecord(object, undefined, storageClassDefinition.type));

        it('Name: kubectl\'s name without its `(default)` suffix, which the annotation of the default class makes', () => {
          expect(row.name).toBe(cell(cells, 'Name').replace(/ \(default\)$/, ''));
          expect(row.name).toBe(object.metadata.name);
          expect(object.metadata.namespace).toBeUndefined();
          expect(row.namespace).toBe('');
          expect(storageClassDefinition.list.identity.second(row)).toBeNull();
          expect(row.nameTail).toBe(0);
        });

        it('Provisioner, ReclaimPolicy, VolumeBindingMode: the texts kubectl prints', () => {
          expect(row.provisioner).toBe(cell(cells, 'Provisioner'));
          expect(row.reclaimPolicy).toBe(cell(cells, 'ReclaimPolicy'));
          expect(row.binding).toBe(cell(cells, 'VolumeBindingMode'));
          expect(field('provisioner').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'Provisioner') });
          expect(field('reclaimPolicy').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'ReclaimPolicy') });
          expect(field('binding').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'VolumeBindingMode') });
        });

        it('Expansion: kubectl\'s `true` or `false` as the mock\'s Yes or No', () => {
          const printed = cell(cells, 'AllowVolumeExpansion');

          expect(['true', 'false']).toContain(printed);
          expect(row.expansion).toBe(printed === 'true');
          expect(field('expansion').display(row, now)).toEqual({ kind: 'text', text: printed === 'true' ? 'Yes' : 'No' });
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show', () => {
  const captured = golden.captures.flatMap((capture) => capture.rows);
  const rows = captured.map(({ object }) => storageClassRow(hostRecord(object, undefined, storageClassDefinition.type)));

  it('holds the default class, which kubectl writes with a suffix the list does not', () => {
    const printed = captured.map(({ cells, object }) => [object.metadata.name, String(cells[0])]);

    expect(printed).toContainEqual(['standard', 'standard (default)']);
    expect(rows.map((row) => row.name)).toContain('standard');
  });

  it('holds a class that allows expansion, and classes that state none: the API omits allowVolumeExpansion when it is false', () => {
    const stated = captured.map(({ object }) => 'allowVolumeExpansion' in object);

    expect(rows.filter((row) => row.expansion === true).map((row) => row.name)).toEqual(['fast']);
    expect(rows.filter((row) => row.expansion === false)).toHaveLength(3);
    expect(stated.filter(Boolean)).toHaveLength(1);
  });

  it('holds both binding modes and both reclaim policies the fixture\'s classes use', () => {
    expect(new Set(rows.map((row) => row.binding))).toEqual(new Set(['Immediate', 'WaitForFirstConsumer']));
    expect(new Set(rows.map((row) => row.reclaimPolicy))).toEqual(new Set(['Delete', 'Retain']));
  });

  it('has no quick filters, and four rows', () => {
    expect(storageClassDefinition.list.quickFilters).toEqual([]);
    expect(rows).toHaveLength(4);
  });
});
