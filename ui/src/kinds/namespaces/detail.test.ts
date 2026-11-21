import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { annotationModels } from '../detail/metadata';
import { describedFields, describedSection, parseDetailFixture, rowsOf } from '../detail/testing';
import { hostRecord, idOf, type CapturedObject } from '../testing';

import { namespaceDefinition } from './definition';
import { namespaceCommands, namespaceOverview } from './detail';
import { namespaceRow } from './row';

// The page of a Namespace, held to the objects of a real cluster: every Namespace of the fixture (`kubectl get namespaces -o json` on kind v1.35.0; hack/kinds-capture/capture-detail.mjs), and what `kubectl
// describe` prints of each. A Namespace says its Details only while it is Terminating: the finalizers that hold it and when its deletion began (the values are the API's, decision A19).

/** The part of a Namespace these cases read, as `kubectl get -o json` prints it. */
type NamespaceJson = CapturedObject & {
  readonly metadata: CapturedObject['metadata'] & {
    readonly creationTimestamp: string;
    readonly deletionTimestamp?: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly annotations?: Readonly<Record<string, string>>;
  };
  readonly spec?: { readonly finalizers?: readonly string[] };
  readonly status?: {
    readonly phase?: string;
    readonly conditions?: ReadonlyArray<{ readonly type: string; readonly status: string; readonly reason?: string }>;
  };
};

const golden = parseDetailFixture<NamespaceJson>(readFileSync(path.join(import.meta.dirname, 'fixtures/namespaces-detail.json'), 'utf8'));
const record = (object: unknown) => hostRecord(object, undefined, namespaceDefinition.type);
const rows = (object: unknown) => rowsOf(namespaceOverview(record(object)));
const found = (id: string) => {
  const entry = golden.objects.find(({ object }) => idOf(object) === id);
  if (entry === undefined) {
    throw new Error(`the fixture has no ${id}`);
  }

  return entry;
};

/** What describe prints under a heading: the rest of its line and the lines indented under it (`Labels:` and `Annotations:` continue on following lines). */
function describedBlock(described: string, heading: string): readonly string[] {
  const lines = described.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${heading}:`));
  if (start === -1) {
    return [];
  }

  const first = (lines[start] ?? '').slice(heading.length + 1).trim();
  const rest: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) {
      break;
    }

    rest.push(line.trim());
  }

  return [first, ...rest];
}

describe('the Namespaces the fixture holds', () => {
  it('has the ones the cases below name: one that is terminating, one that states labels and a credential', () => {
    expect(golden.objects.length).toBeGreaterThanOrEqual(15);
    for (const id of ['detail', 'terminating', 'default', 'kube-system']) {
      expect(golden.objects.some(({ object }) => idOf(object) === id), id).toBe(true);
    }
  });
});

describe('a Namespace that is being deleted (terminating)', () => {
  const { object } = found('terminating');

  it('says the header\'s word, the age, and no summary: the counts of what is in it need the other kinds', () => {
    const overview = namespaceOverview(record(object));
    expect(overview.state).toEqual({ word: 'Terminating', role: 'progress' });
    expect(overview.createdAt).toBe(Date.parse(object.metadata.creationTimestamp));
    expect(overview.summary).toEqual([]);
  });

  it('has its finalizers as chips and when the deletion began, in the mock\'s order', () => {
    expect(rows(object)).toEqual([['Finalizers', 'kubernetes'], ['Deleting since', `at ${new Date('2026-11-21T08:24:03Z').toISOString()}`]]);
  });

  it('says the deletion as an instant, and the finalizers as chips with no value', () => {
    const [finalizers, deleting] = namespaceOverview(record(object)).details;
    expect(finalizers?.value).toEqual({ kind: 'tags', items: [{ key: 'kubernetes' }] });
    expect(deleting?.value).toEqual({ kind: 'moment', at: Date.parse('2026-11-21T08:24:03Z') });
  });

  it('says every finalizer the object holds, in its order', () => {
    const several = { ...object, spec: { finalizers: ['kubernetes', 'example.com/hold'] } };
    expect(rows(several)[0]).toEqual(['Finalizers', 'kubernetes, example.com/hold']);
  });

  it('has the five conditions the API states, in its order (their roles are those of the shared table, `../detail/conditions.ts`)', () => {
    expect(namespaceOverview(record(object)).conditions.map((row) => [row.type, row.status, row.reason])).toEqual([
      ['NamespaceDeletionDiscoveryFailure', 'False', 'ResourcesDiscovered'],
      ['NamespaceDeletionGroupVersionParsingFailure', 'False', 'ParsedGroupVersions'],
      ['NamespaceDeletionContentFailure', 'False', 'ContentDeleted'],
      ['NamespaceContentRemaining', 'True', 'SomeResourcesRemain'],
      ['NamespaceFinalizersRemaining', 'True', 'SomeFinalizersRemain'],
    ]);
  });

  it('has no Finalizers row when the Namespace holds none, and keeps the deletion', () => {
    const none = { ...object, spec: { finalizers: [] } };
    expect(rows(none).map(([label]) => label)).toEqual(['Deleting since']);
  });
});

describe('a Namespace that is active (detail)', () => {
  const { object } = found('detail');

  it('has no Details row: its finalizers and a deletion are said only while it is being deleted, though the object holds a finalizer', () => {
    expect(object.spec?.finalizers).toEqual(['kubernetes']);
    expect(namespaceOverview(record(object)).state).toEqual({ word: 'Active', role: 'healthy' });
    expect(rows(object)).toEqual([]);
  });

  it('has the labels of the object, and a credential\'s value nowhere', () => {
    const overview = namespaceOverview(record(object));
    expect(overview.labels.map((tag) => [tag.key, tag.value])).toEqual([['kubernetes.io/metadata.name', 'detail'], ['team', 'checkout'], ['tier', 'backend']]);
    expect(overview.annotations.map((tag) => [tag.key, tag.protected])).toEqual([['example.io/api-token', true], ['example.io/owner-team', false]]);
    expect(JSON.stringify(overview)).not.toContain('sentinel-namespace-token');
  });
});

describe('every Namespace of the cluster, against `kubectl describe`', () => {
  for (const { object, describe: described } of golden.objects) {
    const id = idOf(object);
    const fields = described === undefined ? new Map<string, string>() : describedFields(described);

    it(`${id}: the header says describe's Status, and the list's word`, () => {
      const overview = namespaceOverview(record(object));
      expect(overview.state?.word).toBe(fields.get('Status'));
      expect(overview.state).toEqual(namespaceRow(record(object)).status);
    });

    it(`${id}: the Details rows are there while it is terminating, and the labels and annotations are describe's`, () => {
      const overview = namespaceOverview(record(object));
      const terminating = fields.get('Status') === 'Terminating';
      expect(rows(object).map(([label]) => label), id).toEqual(terminating ? ['Finalizers', 'Deleting since'] : []);
      const labels = describedBlock(described ?? '', 'Labels');
      expect(overview.labels.map((tag) => `${tag.key}=${tag.value ?? ''}`).sort()).toEqual([...labels].sort());
      const annotations = describedBlock(described ?? '', 'Annotations').filter((line) => line !== '<none>');
      // describe leaves the last applied configuration out of its list; the page has it, masked.
      expect(overview.annotations.map((tag) => tag.key).filter((key) => key !== 'kubectl.kubernetes.io/last-applied-configuration').sort()).toEqual(annotations.map((line) => line.split(':')[0]).sort());
      expect(overview.annotations).toEqual(annotationModels(object.metadata.annotations ?? {}));
    });

    it(`${id}: the conditions are describe's table, type, status and reason`, () => {
      const shown = namespaceOverview(record(object)).conditions.map((row) => `${row.type} ${row.status} ${row.reason ?? ''}`.trim());
      // Type, Status, the transition time (which ends in its zone offset) and the Reason.
      const table = describedSection(described ?? '', 'Conditions')
        .filter((line) => line !== '' && !line.startsWith('Type') && !line.startsWith('----'))
        .map((line) => {
          const [, type, status, reason] = /^(\S+)\s+(\S+)\s+.*?[+-]\d{4}\s+(\S+)/.exec(line) ?? [];
          return `${type ?? '?'} ${status ?? '?'} ${reason ?? '?'}`;
        });
      expect(shown).toEqual(table);
    });

    it(`${id}: no row is empty, and the finalizers are the object's`, () => {
      for (const [label, text] of rows(object)) {
        expect(text, label).not.toBe('');
      }
      const finalizers = rows(object).find(([label]) => label === 'Finalizers')?.[1];
      if (finalizers !== undefined) {
        expect(finalizers).toBe((object.spec?.finalizers ?? []).join(', '));
      }
    });
  }
});

describe('an object that says little, or is not a Namespace at all', () => {
  it('says nothing of a state or a row it does not hold, and no word is made up', () => {
    const overview = namespaceOverview(record({ metadata: { name: 'x' } }));
    expect(overview.state).toBeUndefined();
    expect(overview.summary).toEqual([]);
    expect(overview.details).toEqual([]);
    expect(overview.conditions).toEqual([]);
  });

  it('says a Terminating Namespace\'s rows only for what it holds', () => {
    const overview = namespaceOverview(record({ metadata: { name: 'x', deletionTimestamp: '2026-11-21T08:24:03Z' } }));
    expect(overview.state?.word).toBe('Terminating');
    expect(overview.details.map((fact) => fact.label)).toEqual(['Deleting since']);
  });

  it('keeps each field only when it has the type the API gives it', () => {
    const overview = namespaceOverview(record({ metadata: { name: 'x', labels: 'bad', deletionTimestamp: 7 }, spec: { finalizers: 'kubernetes' }, status: { phase: 'Terminating', conditions: 'bad' } }));
    expect(overview.details).toEqual([]);
    expect(overview.labels).toEqual([]);
    expect(overview.conditions).toEqual([]);
  });

  it('reads an object of another shape as an empty Namespace, never an error', () => {
    for (const body of [null, 'not an object', 7, [], { spec: [], status: 'x' }]) {
      expect(() => namespaceOverview(record(body))).not.toThrow();
      expect(namespaceOverview(record(body)).details).toEqual([]);
    }
  });
});

describe('what the definition says of its page', () => {
  it('has a page of its own, named for the Kind, whose route names the object by its name alone: a Namespace lives in none', () => {
    expect(namespaceDefinition.detail?.page).toBe('namespace');
    expect(namespaceDefinition.detail?.identity).toEqual(['name']);
    expect(namespaceDefinition.detail?.overview).toBe(namespaceOverview);
  });

  it('lays out the commands the mock lays out for a Namespace (K59): Delete, and the menu', () => {
    expect(namespaceDefinition.detail?.commands).toBe(namespaceCommands);
    expect(namespaceCommands(record(found('detail').object))).toEqual({
      danger: { id: 'delete', label: 'Delete' },
      menu: [{ id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
    });
  });
});
