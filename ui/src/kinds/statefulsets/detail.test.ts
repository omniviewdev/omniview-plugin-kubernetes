import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { annotationModels } from '../detail/metadata';
import { describedFields, describedSection, parseDetailFixture, rowsOf, summaryText } from '../detail/testing';
import { hostRecord, idOf, type CapturedObject } from '../testing';

import { statefulSetDefinition } from './definition';
import { statefulSetCommands, statefulSetOverview } from './detail';
import { statefulSetRow } from './row';

// The page of a StatefulSet, held to the objects of a real cluster: every StatefulSet of the fixture (`kubectl get statefulsets -A -o json` on kind v1.35.0; hack/kinds-capture/capture-detail.mjs) and
// what `kubectl describe` prints of each. The oracle of the Details card is the object, field for field as the definition maps it (the values are the API's, decision A19; the words are the mock's), and
// `describe` where a row is a derived value: the update strategy, the selector, the counts, the service account. The Service, the Pod management, the Claim retention and the Revision are not in `describe`.

/** The part of a StatefulSet these cases read, as `kubectl get -o json` prints it. */
type StatefulSetJson = CapturedObject & {
  readonly metadata: CapturedObject['metadata'] & {
    readonly creationTimestamp: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly annotations?: Readonly<Record<string, string>>;
  };
  readonly spec: {
    readonly replicas?: number;
    readonly serviceName?: string;
    readonly podManagementPolicy?: string;
    readonly persistentVolumeClaimRetentionPolicy?: { readonly whenDeleted?: string; readonly whenScaled?: string };
    readonly updateStrategy?: { readonly type?: string; readonly rollingUpdate?: { readonly partition?: number; readonly maxUnavailable?: number | string } };
    readonly template: { readonly spec: { readonly serviceAccountName?: string } };
  };
  readonly status: {
    readonly readyReplicas?: number;
    readonly updatedReplicas?: number;
    readonly updateRevision?: string;
  };
};

const golden = parseDetailFixture<StatefulSetJson>(readFileSync(path.join(import.meta.dirname, 'fixtures/statefulsets-detail.json'), 'utf8'));
const record = (object: unknown) => hostRecord(object, undefined, statefulSetDefinition.type);

/** The Details card as label and text. */
const rows = (object: unknown) => rowsOf(statefulSetOverview(record(object)));
const found = (id: string) => {
  const entry = golden.objects.find(({ object }) => idOf(object) === id);
  if (entry === undefined) {
    throw new Error(`the fixture has no ${id}`);
  }

  return entry;
};

describe('the StatefulSets the fixture holds', () => {
  it('has the ones the cases below name: every state of the rule, an ordinal-free one, a Parallel one with a partition', () => {
    for (const id of ['checkout/cart-cache', 'detail/on-delete', 'detail/ordered-db', 'states/bad-image', 'states/half-ready', 'states/scaled-zero']) {
      expect(golden.objects.some(({ object }) => idOf(object) === id), id).toBe(true);
    }
  });
});

describe('a StatefulSet that states every optional row of the Details card (detail/ordered-db)', () => {
  const { object } = found('detail/ordered-db');

  it('says the header\'s word, the one-line summary without it, and the age the object counts from', () => {
    const overview = statefulSetOverview(record(object));
    expect(overview.state).toEqual({ word: 'Available', role: 'healthy' });
    expect(summaryText(overview.summary)).toEqual(['2/2 ready', 'up to date']);
    expect(overview.createdAt).toBe(Date.parse(object.metadata.creationTimestamp));
  });

  it('has each row, in the mock\'s order: service, update strategy, pod management, claim retention, revision, service account, selector', () => {
    expect(rows(object)).toEqual([
      ['Service', 'ordered-db'],
      ['Update strategy', 'Rolling update · max unavailable 1, partition 1'],
      ['Pod management', 'Parallel'],
      ['Claim retention', 'Removed on delete, kept on scale-down'],
      ['Revision', 'ordered-db-5df7d77dbf'],
      ['Service account', 'builder'],
      ['Selector', 'app=ordered-db'],
    ]);
  });

  it('spans the whole width for the selector only, and says the revision as an identifier', () => {
    const { details } = statefulSetOverview(record(object));
    expect(details.filter((fact) => fact.wide === true).map((fact) => fact.label)).toEqual(['Selector']);
    expect(details.find((fact) => fact.label === 'Revision')?.value).toMatchObject({ kind: 'text', mono: true });
  });

  it('names the governing Service and the service account as objects of the namespace, drawn with the name alone', () => {
    const { details } = statefulSetOverview(record(object));
    expect(details.find((fact) => fact.label === 'Service')?.value).toEqual({ kind: 'ref', ref: { kind: 'Service', name: 'ordered-db', namespace: 'detail' }, text: 'ordered-db' });
    expect(details.find((fact) => fact.label === 'Service account')?.value).toEqual({ kind: 'ref', ref: { kind: 'ServiceAccount', name: 'builder', namespace: 'detail' }, text: 'builder' });
  });
});

describe('a StatefulSet that replaces its Pods only when told to (detail/on-delete)', () => {
  const { object } = found('detail/on-delete');

  it('has the rows its object states: a Service that does not exist is still the Service it names, and no service account is made up', () => {
    expect(rows(object)).toEqual([
      ['Service', 'not-there'],
      ['Update strategy', 'On delete'],
      ['Pod management', 'OrderedReady'],
      ['Claim retention', 'Kept on delete and scale-down'],
      ['Revision', 'on-delete-8d7b98bf7'],
      ['Selector', 'app=on-delete'],
    ]);
  });
});

describe('each state of the rule, as the summary says it', () => {
  const summary = (id: string) => summaryText(statefulSetOverview(record(found(id).object)).summary);
  const state = (id: string) => statefulSetOverview(record(found(id).object)).state?.word;

  it.each([
    ['checkout/cart-cache', 'Available', ['2/2 ready', 'up to date']],
    // The API omits `updatedReplicas` for none, which is the API's zero once the object has a status: nothing wanted, nothing behind.
    ['states/scaled-zero', 'Scaled to zero', ['0/0 ready', 'up to date']],
    ['states/bad-image', 'Unavailable', ['0/1 ready', 'up to date']],
    ['states/half-ready', 'Partially ready', ['1/2 ready', 'up to date']],
  ] as const)('%s is %s: %j', (id, word, expected) => {
    expect(state(id)).toBe(word);
    expect(summary(id)).toEqual(expected);
  });

  it('says a rollout that is behind as the Pods that are up to date, and an absent count as none', () => {
    const { object } = found('checkout/cart-cache');
    const { updatedReplicas: _, ...status } = object.status;
    expect(summaryText(statefulSetOverview(record({ ...object, status: { ...status, updatedReplicas: 1 } })).summary)).toEqual(['2/2 ready', '1 up to date']);
    expect(summaryText(statefulSetOverview(record({ ...object, status })).summary)).toEqual(['2/2 ready', '0 up to date']);
  });
});

describe('the rows the object does not state give no row', () => {
  const { object } = found('detail/ordered-db');
  const without = (patch: (spec: StatefulSetJson['spec']) => unknown) => rows({ ...object, spec: patch(object.spec) });
  const labels = (list: ReturnType<typeof rows>) => list.map(([label]) => label);

  it('has no Service for an empty or absent serviceName, no Pod management without a policy, no Claim retention without one', () => {
    expect(labels(without(({ serviceName: _, ...spec }) => spec))).not.toContain('Service');
    expect(labels(without((spec) => ({ ...spec, serviceName: '' })))).not.toContain('Service');
    expect(labels(without(({ podManagementPolicy: _, ...spec }) => spec))).not.toContain('Pod management');
    expect(labels(without(({ persistentVolumeClaimRetentionPolicy: _, ...spec }) => spec))).not.toContain('Claim retention');
  });

  it('has no Revision without a status revision', () => {
    const { updateRevision: _, ...status } = object.status;
    expect(labels(rows({ ...object, status }))).not.toContain('Revision');
  });

  it('says a claim policy with only one of its two fields as the API defaults the other', () => {
    const text = (policy: unknown) => without((spec) => ({ ...spec, persistentVolumeClaimRetentionPolicy: policy })).find(([label]) => label === 'Claim retention')?.[1];
    expect(text({ whenScaled: 'Delete' })).toBe('Kept on delete, removed on scale-down');
    expect(text({ whenDeleted: 'Delete', whenScaled: 'Delete' })).toBe('Removed on delete and scale-down');
  });
});

describe('the conditions, the labels and the annotations', () => {
  const { object } = found('detail/ordered-db');
  const applied = 'kubectl.kubernetes.io/last-applied-configuration';

  it('has the conditions the status states, as the object states them', () => {
    const conditions = [{ type: 'Available', status: 'True', reason: 'AllReplicasReady' }];
    expect(statefulSetOverview(record({ ...object, status: { ...object.status, conditions } })).conditions.map((row) => [row.type, row.status, row.reason])).toEqual([['Available', 'True', 'AllReplicasReady']]);
  });

  it('has no credential\'s value and no last applied configuration in the data', () => {
    const annotations = { 'example.io/api-token': 'sentinel-statefulset-token', [applied]: 'sentinel-applied-configuration' };
    const overview = statefulSetOverview(record({ ...object, metadata: { ...object.metadata, annotations } }));
    expect(overview.annotations.map((tag) => [tag.key, tag.protected])).toEqual([['example.io/api-token', true], [applied, true]]);
    expect(JSON.stringify(overview)).not.toContain('sentinel-statefulset-token');
    expect(JSON.stringify(overview)).not.toContain('sentinel-applied-configuration');
  });
});

describe('the strategy, the selector and the counts, against `kubectl describe`', () => {
  for (const { object, describe: described } of golden.objects) {
    const id = idOf(object);
    const fields = described === undefined ? new Map<string, string>() : describedFields(described);
    const row = (label: string) => rows(object).find(([name]) => name === label)?.[1];

    it(`${id}: the Update strategy row is describe's Update Strategy, with its Partition and MaxUnavailable`, () => {
      const nested = Object.fromEntries(describedSection(described ?? '', 'Update Strategy').map((line) => line.split(/:\s+/)));
      const type = fields.get('Update Strategy');
      if (type === 'OnDelete') {
        expect(row('Update strategy')).toBe('On delete');
        return;
      }

      expect(type).toBe('RollingUpdate');
      expect(row('Update strategy')).toBe(`Rolling update · max unavailable ${nested.MaxUnavailable ?? '?'}, partition ${nested.Partition ?? '?'}`);
    });

    it(`${id}: the Selector row is describe's selector, chip for chip`, () => {
      const fact = statefulSetOverview(record(object)).details.find((candidate) => candidate.label === 'Selector');
      const shown = fact?.value.kind === 'tags' ? fact.value.items.map((item) => (item.value === undefined ? item.key : `${item.key}=${item.value}`)) : [];
      expect(shown.sort()).toEqual((fields.get('Selector') ?? '').split(',').sort());
    });

    it(`${id}: the counts of the summary are describe's Replicas line and the object's own`, () => {
      const [, desired] = /^(\d+) desired \| (\d+) total$/.exec(fields.get('Replicas') ?? '') ?? [];
      const items = summaryText(statefulSetOverview(record(object)).summary);
      expect(Number(desired)).toBe(object.spec.replicas);
      expect(items[0]).toBe(`${object.status.readyReplicas ?? 0}/${desired ?? '?'} ready`);
      const updated = object.status.updatedReplicas ?? 0;
      expect(items[1]).toBe(updated < Number(desired) ? `${updated} up to date` : 'up to date');
    });

    it(`${id}: the Service account is the template's, and Service, Pod management, Claim retention and Revision are the object's`, () => {
      const account = describedSection(described ?? '', 'Pod Template').find((line) => line.startsWith('Service Account:'))?.replace(/^Service Account:\s+/, '');
      expect(row('Service account')).toBe(account);
      expect(row('Service')).toBe(object.spec.serviceName);
      expect(row('Pod management')).toBe(object.spec.podManagementPolicy);
      expect(row('Revision')).toBe(object.status.updateRevision);
      const policy = object.spec.persistentVolumeClaimRetentionPolicy;
      expect(row('Claim retention')).toBe(`${policy?.whenDeleted === 'Delete' ? 'Removed' : 'Kept'} on delete${policy?.whenDeleted === policy?.whenScaled ? ' and scale-down' : `, ${policy?.whenScaled === 'Delete' ? 'removed' : 'kept'} on scale-down`}`);
    });

    it(`${id}: the labels are describe's, and the annotations are the object's with every credential and the last applied configuration masked`, () => {
      const overview = statefulSetOverview(record(object));
      expect(Object.fromEntries(overview.labels.map((tag) => [tag.key, tag.value]))).toEqual(object.metadata.labels ?? {});
      expect(overview.annotations).toEqual(annotationModels(object.metadata.annotations ?? {}));
      for (const tag of overview.annotations) {
        if (tag.protected) {
          expect(tag.value, tag.key).toBeUndefined();
        }
      }
    });

    it(`${id}: the header says the word the list says, and no row is empty`, () => {
      const overview = statefulSetOverview(record(object));
      expect(overview.state).toEqual(statefulSetRow(record(object)).status);
      expect(overview.createdAt).toBe(statefulSetRow(record(object)).createdAt);
      for (const [label, text] of rowsOf(overview)) {
        expect(text, label).not.toBe('');
      }
    });
  }
});

describe('an object that says little, or is not a StatefulSet at all', () => {
  it('says nothing of a state or a count it does not hold, and no word is made up', () => {
    const overview = statefulSetOverview(record({ metadata: { name: 'x', namespace: 'n' } }));
    expect(overview.state).toBeUndefined();
    expect(overview.summary).toEqual([]);
    expect(overview.details).toEqual([]);
    expect(overview.conditions).toEqual([]);
  });

  it('keeps each field only when it has the type the API gives it', () => {
    const overview = statefulSetOverview(record({
      metadata: { name: 'x', namespace: 'n', labels: 'bad' },
      spec: { replicas: 'many', serviceName: 4, updateStrategy: 'x', podManagementPolicy: [], persistentVolumeClaimRetentionPolicy: 'x', selector: [], template: 'x' },
      status: { updateRevision: 7, conditions: 'bad' },
    }));
    expect(overview.details).toEqual([]);
    expect(overview.summary).toEqual([]);
    expect(overview.labels).toEqual([]);
    expect(overview.conditions).toEqual([]);
  });

  it('reads an object of another shape as an empty StatefulSet, never an error', () => {
    expect(() => statefulSetOverview(record('not an object'))).not.toThrow();
    expect(statefulSetOverview(record(null)).details).toEqual([]);
  });
});

describe('what the definition says of its page', () => {
  it('has a page of its own, named for the Kind, whose route names the object by its namespace and its name', () => {
    expect(statefulSetDefinition.detail?.page).toBe('statefulset');
    expect(statefulSetDefinition.detail?.identity).toEqual(['namespace', 'name']);
    expect(statefulSetDefinition.detail?.overview).toBe(statefulSetOverview);
  });

  it('lays out the commands the mock lays out for a StatefulSet, every one of them offered unavailable', () => {
    expect(statefulSetDefinition.detail?.commands).toBe(statefulSetCommands);
    expect(statefulSetCommands(record(found('detail/ordered-db').object))).toEqual({
      primary: { id: 'scale', label: 'Scale' },
      secondary: [{ id: 'restart', label: 'Restart' }, { id: 'logs', label: 'Logs' }],
      danger: { id: 'delete', label: 'Delete' },
      menu: [{ id: 'forward-port', label: 'Forward port…' }, { id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
    });
  });
});
