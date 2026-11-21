import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { annotationModels } from '../detail/metadata';
import { parseDetailFixture, rowsOf, summaryText } from '../detail/testing';
import { counted } from '../detail/text';
import { bytesText } from '../fields';
import { hostRecord, idOf, type CapturedObject } from '../testing';

import { configMapDefinition } from './definition';
import { configMapCommands, configMapOverview } from './detail';
import { configMapRow } from './row';

// The page of a ConfigMap, held to the objects of a real cluster: every ConfigMap of the fixture's namespaces `detail` and `more` (`kubectl get configmaps -A -o json` on kind v1.35.0;
// hack/kinds-capture/capture-detail.mjs). There is no `describe` beside them: it prints the values, which the page never reads. The oracle is the object itself: its `immutable`, its keys and the bytes of
// its values. The page reads no value of `data` beyond what the list derives (the key names and the size).

/** The part of a ConfigMap these cases read, as `kubectl get -o json` prints it. */
type ConfigMapJson = CapturedObject & {
  readonly metadata: CapturedObject['metadata'] & {
    readonly creationTimestamp: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly annotations?: Readonly<Record<string, string>>;
  };
  readonly immutable?: boolean;
  readonly data?: Readonly<Record<string, string>>;
  readonly binaryData?: Readonly<Record<string, string>>;
};

const golden = parseDetailFixture<ConfigMapJson>(readFileSync(path.join(import.meta.dirname, 'fixtures/configmaps-detail.json'), 'utf8'));
const record = (object: unknown) => hostRecord(object, undefined, configMapDefinition.type);

/** The Details card as label and text. */
const rows = (object: unknown) => rowsOf(configMapOverview(record(object)));
const found = (id: string) => {
  const entry = golden.objects.find(({ object }) => idOf(object) === id);
  if (entry === undefined) {
    throw new Error(`the fixture has no ${id}`);
  }

  return entry;
};

describe('the ConfigMaps the fixture holds', () => {
  it('has the ones the cases below name: an immutable one with data and binary data, and a mutable one with binary data', () => {
    for (const id of ['detail/frozen', 'more/binary']) {
      expect(golden.objects.some(({ object }) => idOf(object) === id), id).toBe(true);
    }
  });
});

describe('a ConfigMap that states every optional row of the Details card (detail/frozen)', () => {
  const { object } = found('detail/frozen');

  it('says no header word, the keys and the size on the summary line, and the age the object counts from', () => {
    const overview = configMapOverview(record(object));
    expect(overview.state).toBeUndefined();
    expect(summaryText(overview.summary)).toEqual(['3 keys', bytesText(configMapRow(record(object)).size ?? NaN)]);
    expect(overview.createdAt).toBe(Date.parse(object.metadata.creationTimestamp));
  });

  it('has the Immutable row, as the object states it', () => {
    expect(rows(object)).toEqual([['Immutable', 'Yes']]);
  });

  it('has the labels and annotations of the object, as the shared rule shows them', () => {
    const overview = configMapOverview(record(object));
    expect(overview.labels.map((tag) => [tag.key, tag.value])).toEqual(Object.entries(object.metadata.labels ?? {}));
    expect(overview.annotations).toEqual(annotationModels(object.metadata.annotations ?? {}));
    expect(overview.annotations.map((tag) => [tag.key, tag.value, tag.protected])).toEqual([['example.io/owner-team', 'checkout', false]]);
  });
});

describe('every ConfigMap of the fixture, against its own fields', () => {
  for (const { object } of golden.objects) {
    const id = idOf(object);

    it(`${id}: the Immutable row is there only when the object says true, and the summary is the list's keys and size`, () => {
      expect(rows(object).map(([label]) => label)).toEqual(object.immutable === true ? ['Immutable'] : []);
      const names = new Set([...Object.keys(object.data ?? {}), ...Object.keys(object.binaryData ?? {})]);
      const row = configMapRow(record(object));
      expect(summaryText(configMapOverview(record(object)).summary)).toEqual([counted(names.size, 'key'), bytesText(row.size ?? NaN)]);
      expect(row.names).toEqual([...names].sort());
    });

    it(`${id}: the header says no word, and no row is empty`, () => {
      const overview = configMapOverview(record(object));
      expect(overview.state).toBeUndefined();
      expect(overview.conditions).toEqual([]);
      for (const [label, text] of rowsOf(overview)) {
        expect(text, label).not.toBe('');
      }
    });
  }
});

describe('the values of a ConfigMap are not read by the page', () => {
  it('has no value of `data` or `binaryData` anywhere in the overview, nor a protected annotation\'s or the last applied configuration\'s', () => {
    const { object } = found('detail/frozen');
    const applied = 'kubectl.kubernetes.io/last-applied-configuration';
    const body = {
      ...object,
      data: { ...object.data, 'sentinel-key': 'sentinel-configmap-value' },
      binaryData: { blob: 'c2VudGluZWwtYmluYXJ5LXZhbHVl' },
      metadata: { ...object.metadata, annotations: { 'example.io/api-token': 'sentinel-configmap-token', [applied]: '{"sentinel-applied":1}' } },
    };
    const overview = configMapOverview(record(body));
    const json = JSON.stringify(overview);
    expect(json).not.toContain('sentinel-configmap-value');
    expect(json).not.toContain('c2VudGluZWwtYmluYXJ5LXZhbHVl');
    expect(json).not.toContain('sentinel-configmap-token');
    expect(json).not.toContain('sentinel-applied');
    // The names count (greeting, multi, sentinel-key and blob), the values never appear.
    expect(summaryText(overview.summary)[0]).toBe('4 keys');
  });

  it('says Immutable only for a boolean true at the top level of the object, and not for `data` that holds such a key', () => {
    expect(rows({ metadata: { name: 'x' }, immutable: false })).toEqual([]);
    expect(rows({ metadata: { name: 'x' }, immutable: 'true' })).toEqual([]);
    expect(rows({ metadata: { name: 'x' }, data: { immutable: 'true' } })).toEqual([]);
    expect(rows({ metadata: { name: 'x' }, immutable: true })).toEqual([['Immutable', 'Yes']]);
  });
});

describe('an object that says little, or is not a ConfigMap at all', () => {
  it('says the keys and the size of an object with no data as the list does: no key, no bytes', () => {
    const overview = configMapOverview(record({ metadata: { name: 'x', namespace: 'n' } }));
    expect(overview.state).toBeUndefined();
    expect(summaryText(overview.summary)).toEqual(['0 keys', '0 B']);
    expect(overview.details).toEqual([]);
  });

  it('keeps each field only when it has the type the API gives it', () => {
    const overview = configMapOverview(record({ metadata: { name: 'x', namespace: 'n', labels: 'bad' }, immutable: 1, data: 'bad' }));
    expect(overview.details).toEqual([]);
    expect(overview.labels).toEqual([]);
  });

  it('reads an object of another shape as an empty ConfigMap, never an error, and with no summary: the list has no keys to say', () => {
    expect(() => configMapOverview(record('not an object'))).not.toThrow();
    expect(configMapOverview(record(null)).summary).toEqual([]);
    expect(configMapOverview(record(null)).details).toEqual([]);
  });
});

describe('what the definition says of its page', () => {
  it('has a page of its own, named for the Kind, whose route names the object by its namespace and its name', () => {
    expect(configMapDefinition.detail?.page).toBe('configmap');
    expect(configMapDefinition.detail?.identity).toEqual(['namespace', 'name']);
    expect(configMapDefinition.detail?.overview).toBe(configMapOverview);
  });

  it('lays out the commands the mock lays out for a ConfigMap (K59): Delete and the menu, no primary and no secondary', () => {
    expect(configMapDefinition.detail?.commands).toBe(configMapCommands);
    expect(configMapCommands(record(found('detail/frozen').object))).toEqual({
      danger: { id: 'delete', label: 'Delete' },
      menu: [{ id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
    });
  });
});
