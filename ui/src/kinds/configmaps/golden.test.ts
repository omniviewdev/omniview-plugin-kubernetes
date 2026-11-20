import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { bytesText, formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture, type CapturedObject } from '../testing';

import { configMapDefinition } from './definition';
import { configMapRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the ConfigMap object and the cells the server printed for it, taken together
// (fixtures/configmaps-table.json, made by hack/kinds-capture/capture.mjs on the cluster that more-kinds.sh fills). `kubectl get configmaps -A` prints these cells: NAME DATA AGE. DATA is the number of
// keys of data and binaryData together. kubectl prints no size and no names: those are checked against the object itself, with the Node's own Buffer, not the code that reads them in the list.

/** The two maps of a ConfigMap, as the fixture holds them. */
type Entries = { readonly data?: Readonly<Record<string, string>>; readonly binaryData?: Readonly<Record<string, string>> };

/** A capture whose objects are ConfigMaps: the part of the object the list reads, beside what every capture has. */
type ConfigMapCapture = Omit<Capture, 'rows'> & { readonly rows: ReadonlyArray<{ readonly cells: Capture['rows'][number]['cells']; readonly object: CapturedObject & Entries }> };

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/configmaps-table.json'), 'utf8')) as { captures: readonly ConfigMapCapture[] };

/** The bytes of the values, counted by the platform: the text of `data` as UTF-8, the bytes `binaryData` decodes to. */
function bytesOf({ data = {}, binaryData = {} }: Entries): number {
  return Object.values(data).reduce((sum, value) => sum + Buffer.byteLength(value, 'utf8'), 0) + Object.values(binaryData).reduce((sum, value) => sum + Buffer.from(value, 'base64').length, 0);
}

const field = (id: string) => configMapDefinition.fields.find((candidate) => candidate.id === id)!;

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = configMapRow(hostRecord(object, undefined, configMapDefinition.type));

        it('Keys: the number kubectl prints as DATA', () => {
          expect(row.keys).toBe(Number(cell(cells, 'Data')));
          expect(field('keys').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'Data'), mono: true });
        });

        it('Key names: the keys of data and binaryData, in order, the first three in the cell', () => {
          const names = [...Object.keys(object.data ?? {}), ...Object.keys(object.binaryData ?? {})].sort();
          expect(row.names).toEqual(names);
          expect(field('names').display(row, now).kind).toBe(names.length === 0 ? 'none' : 'text');
        });

        it('Size: the bytes of the values, in the mock\'s units', () => {
          expect(row.size).toBe(bytesOf(object));
          expect(field('size').display(row, now)).toEqual({ kind: 'text', text: bytesText(bytesOf(object)) });
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: a ConfigMap\'s name is not generated', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show', () => {
  const rows = new Map(golden.captures.flatMap((capture) => capture.rows.map(({ object }) => [idOf(object), configMapRow(hostRecord(object, undefined, configMapDefinition.type))] as const)));

  it('holds a ConfigMap with no key, one with more names than the cell prints, one with a binary value, and one that is large enough for KiB', () => {
    expect(rows.get('more/empty')).toMatchObject({ keys: 0, names: [], size: 0 });
    expect(rows.get('more/many-keys')).toMatchObject({ keys: 5, names: ['alpha', 'bravo', 'charlie', 'delta', 'echo'], size: 5 });
    // `readme` is 24 bytes of text and `blob` decodes to the ten bytes of AAECAwQFBgcICQ==.
    expect(rows.get('more/binary')).toMatchObject({ keys: 2, names: ['blob', 'readme'], size: 24 + 10 });
    expect(field('size').display(rows.get('more/bulk')!, 0)).toEqual({ kind: 'text', text: '1 KiB' });
    expect(rows.size).toBe(25);
  });
});
