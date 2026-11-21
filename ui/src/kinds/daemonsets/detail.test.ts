import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { annotationModels } from '../detail/metadata';
import { describedFields, describedSection, parseDetailFixture, rowsOf, summaryText } from '../detail/testing';
import { hostRecord, idOf, type CapturedObject } from '../testing';

import { daemonSetDefinition } from './definition';
import { daemonSetCommands, daemonSetOverview } from './detail';
import { daemonSetRow } from './row';

// The page of a DaemonSet, held to the objects of a real cluster: every DaemonSet of the fixture (`kubectl get daemonsets -A -o json` on kind v1.35.0; hack/kinds-capture/capture-detail.mjs) and what
// `kubectl describe` prints of each. The oracle of the Details card is the object, field for field as the definition maps it (the values are the API's, decision A19; the words are the mock's), and
// `describe` where a row is a derived value: the Node selector, the counts, the selector, the service account. `describe` does not print the update strategy, so that row is held to the object.

/** The part of a DaemonSet these cases read, as `kubectl get -o json` prints it. */
type DaemonSetJson = CapturedObject & {
  readonly metadata: CapturedObject['metadata'] & {
    readonly creationTimestamp: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly annotations?: Readonly<Record<string, string>>;
  };
  readonly spec: {
    readonly updateStrategy?: { readonly type?: string; readonly rollingUpdate?: { readonly maxSurge?: number | string; readonly maxUnavailable?: number | string } };
    readonly template: { readonly spec: { readonly serviceAccountName?: string; readonly nodeSelector?: Readonly<Record<string, string>> } };
  };
  readonly status: {
    readonly desiredNumberScheduled?: number;
    readonly numberReady?: number;
    readonly numberMisscheduled?: number;
    readonly updatedNumberScheduled?: number;
  };
};

const golden = parseDetailFixture<DaemonSetJson>(readFileSync(path.join(import.meta.dirname, 'fixtures/daemonsets-detail.json'), 'utf8'));
const record = (object: unknown) => hostRecord(object, undefined, daemonSetDefinition.type);

/** The Details card as label and text. */
const rows = (object: unknown) => rowsOf(daemonSetOverview(record(object)));
const found = (id: string) => {
  const entry = golden.objects.find(({ object }) => idOf(object) === id);
  if (entry === undefined) {
    throw new Error(`the fixture has no ${id}`);
  }

  return entry;
};

describe('the DaemonSets the fixture holds', () => {
  it('has the ones the cases below name: one with a Node selector, one without, every state of the rule', () => {
    for (const id of ['detail/selective', 'detail/surging', 'kube-system/kindnet', 'kube-system/kube-proxy', 'monitoring/node-agent', 'states/bad-image', 'states/no-nodes']) {
      expect(golden.objects.some(({ object }) => idOf(object) === id), id).toBe(true);
    }
  });
});

describe('a DaemonSet that says every optional row of the Details card (detail/selective)', () => {
  const { object } = found('detail/selective');

  it('says the header\'s word, the one-line summary without it, and the age the object counts from', () => {
    const overview = daemonSetOverview(record(object));
    expect(overview.state).toEqual({ word: 'Available', role: 'healthy' });
    expect(summaryText(overview.summary)).toEqual(['1/1 ready', '1 up to date']);
    expect(overview.createdAt).toBe(Date.parse(object.metadata.creationTimestamp));
  });

  it('has each row, in the mock\'s order: node selector, update strategy, service account, selector', () => {
    expect(rows(object)).toEqual([
      ['Node selector', 'kubernetes.io/os=linux'],
      ['Update strategy', 'On delete'],
      ['Service account', 'builder'],
      ['Selector', 'app=selective'],
    ]);
  });

  it('draws the Node selector as chips, spans the whole width for the selector only, and names the service account as an object', () => {
    const { details } = daemonSetOverview(record(object));
    expect(details.find((fact) => fact.label === 'Node selector')?.value.kind).toBe('tags');
    expect(details.filter((fact) => fact.wide === true).map((fact) => fact.label)).toEqual(['Selector']);
    expect(details.find((fact) => fact.label === 'Service account')?.value).toEqual({ kind: 'ref', ref: { kind: 'ServiceAccount', name: 'builder', namespace: 'detail' }, text: 'builder' });
  });
});

describe('a DaemonSet that runs on every node (detail/surging)', () => {
  it('says All nodes as text, the rolling update with its two limits, and no service account it does not state', () => {
    const { details } = daemonSetOverview(record(found('detail/surging').object));
    expect(rows(found('detail/surging').object)).toEqual([
      ['Node selector', 'All nodes'],
      ['Update strategy', 'Rolling update · max surge 1, max unavailable 0'],
      ['Selector', 'app=surging'],
    ]);
    expect(details[0]?.value).toEqual({ kind: 'text', text: 'All nodes' });
  });

  it('says All nodes too for a template that holds an empty Node selector, and for one that holds no template at all', () => {
    const { object } = found('detail/surging');
    expect(rows({ ...object, spec: { ...object.spec, template: { spec: { nodeSelector: {} } } } })[0]).toEqual(['Node selector', 'All nodes']);
    const { template: _, ...bare } = object.spec;
    expect(rows({ ...object, spec: bare })[0]).toEqual(['Node selector', 'All nodes']);
  });
});

describe('the nodes a DaemonSet is on the wrong side of', () => {
  const { object } = found('detail/selective');
  const misscheduled = (value: unknown) => rows({ ...object, status: { ...object.status, numberMisscheduled: value } }).find(([label]) => label === 'Misscheduled');

  it('says Misscheduled, between the strategy and the service account, only when the count is more than zero', () => {
    expect(misscheduled(2)).toEqual(['Misscheduled', '2']);
    expect(rows({ ...object, status: { ...object.status, numberMisscheduled: 2 } }).map(([label]) => label)).toEqual(['Node selector', 'Update strategy', 'Misscheduled', 'Service account', 'Selector']);
    expect(misscheduled(0)).toBeUndefined();
    expect(misscheduled('2')).toBeUndefined();
  });
});

describe('each state of the rule, as the summary says it', () => {
  const summary = (id: string) => summaryText(daemonSetOverview(record(found(id).object)).summary);
  const state = (id: string) => daemonSetOverview(record(found(id).object)).state?.word;

  it.each([
    ['kube-system/kindnet', 'Available', ['1/1 ready', '1 up to date']],
    ['states/bad-image', 'Unavailable', ['0/1 ready', '1 up to date']],
    ['states/no-nodes', 'Scaled to zero', ['0/0 ready', '0 up to date']],
  ] as const)('%s is %s: %j', (id, word, expected) => {
    expect(state(id)).toBe(word);
    expect(summary(id)).toEqual(expected);
  });

  it('says an update count the API omits as zero, and says no ratio when either count of it is absent', () => {
    const { object } = found('kube-system/kindnet');
    const { updatedNumberScheduled: _, ...status } = object.status;
    expect(summaryText(daemonSetOverview(record({ ...object, status })).summary)).toEqual(['1/1 ready', '0 up to date']);
    const { numberReady: __, ...unready } = object.status;
    expect(daemonSetOverview(record({ ...object, status: unready })).summary).toEqual([]);
    const { desiredNumberScheduled: ___, ...undesired } = object.status;
    expect(daemonSetOverview(record({ ...object, status: undesired })).summary).toEqual([]);
    const { status: ____, ...unreported } = object;
    expect(daemonSetOverview(record(unreported)).summary).toEqual([]);
  });
});

describe('the conditions, the labels and the annotations', () => {
  const { object } = found('detail/selective');
  const applied = 'kubectl.kubernetes.io/last-applied-configuration';

  it('has the conditions the status states, as the object states them', () => {
    const conditions = [{ type: 'Progressing', status: 'True', reason: 'Updated' }];
    expect(daemonSetOverview(record({ ...object, status: { ...object.status, conditions } })).conditions.map((row) => [row.type, row.status, row.reason])).toEqual([['Progressing', 'True', 'Updated']]);
  });

  it('has no credential\'s value and no last applied configuration in the data', () => {
    const annotations = { 'example.io/api-token': 'sentinel-daemonset-token', [applied]: 'sentinel-applied-configuration' };
    const overview = daemonSetOverview(record({ ...object, metadata: { ...object.metadata, annotations } }));
    expect(overview.annotations.map((tag) => [tag.key, tag.protected])).toEqual([['example.io/api-token', true], [applied, true]]);
    expect(JSON.stringify(overview)).not.toContain('sentinel-daemonset-token');
    expect(JSON.stringify(overview)).not.toContain('sentinel-applied-configuration');
  });
});

describe('the Node selector, the counts and the selector, against `kubectl describe`', () => {
  for (const { object, describe: described } of golden.objects) {
    const id = idOf(object);
    const fields = described === undefined ? new Map<string, string>() : describedFields(described);
    const row = (label: string) => rows(object).find(([name]) => name === label)?.[1];

    it(`${id}: the Node selector row is describe's Node-Selector, and All nodes for <none>`, () => {
      const selector = fields.get('Node-Selector');
      expect(row('Node selector')).toBe(selector === '<none>' ? 'All nodes' : selector?.split(',').join(', '));
    });

    it(`${id}: the Update strategy row is the object's, in the mock's words`, () => {
      const { type, rollingUpdate } = object.spec.updateStrategy ?? {};
      expect(row('Update strategy')).toBe(type === 'OnDelete' ? 'On delete' : `Rolling update · max surge ${rollingUpdate?.maxSurge ?? '?'}, max unavailable ${rollingUpdate?.maxUnavailable ?? '?'}`);
    });

    it(`${id}: the Selector row is describe's selector, chip for chip`, () => {
      const fact = daemonSetOverview(record(object)).details.find((candidate) => candidate.label === 'Selector');
      const shown = fact?.value.kind === 'tags' ? fact.value.items.map((item) => (item.value === undefined ? item.key : `${item.key}=${item.value}`)) : [];
      expect(shown.sort()).toEqual((fields.get('Selector') ?? '').split(',').sort());
    });

    it(`${id}: the counts of the summary and the Misscheduled row are describe's`, () => {
      const items = summaryText(daemonSetOverview(record(object)).summary);
      const desired = Number(fields.get('Desired Number of Nodes Scheduled'));
      expect(desired).toBe(object.status.desiredNumberScheduled);
      expect(items).toEqual([`${object.status.numberReady ?? 0}/${desired} ready`, `${fields.get('Number of Nodes Scheduled with Up-to-date Pods')} up to date`]);
      const misscheduled = Number(fields.get('Number of Nodes Misscheduled'));
      expect(row('Misscheduled')).toBe(misscheduled > 0 ? String(misscheduled) : undefined);
    });

    it(`${id}: the Service account is the template's`, () => {
      const account = describedSection(described ?? '', 'Pod Template').find((line) => line.startsWith('Service Account:'))?.replace(/^Service Account:\s+/, '');
      expect(row('Service account')).toBe(account);
    });

    it(`${id}: the labels are describe's, and the annotations are the object's with every credential and the last applied configuration masked`, () => {
      const overview = daemonSetOverview(record(object));
      expect(Object.fromEntries(overview.labels.map((tag) => [tag.key, tag.value]))).toEqual(object.metadata.labels ?? {});
      expect(overview.annotations).toEqual(annotationModels(object.metadata.annotations ?? {}));
      for (const tag of overview.annotations) {
        if (tag.protected) {
          expect(tag.value, tag.key).toBeUndefined();
        }
      }
    });

    it(`${id}: the header says the word the list says, and no row is empty`, () => {
      const overview = daemonSetOverview(record(object));
      expect(overview.state).toEqual(daemonSetRow(record(object)).status);
      expect(overview.createdAt).toBe(daemonSetRow(record(object)).createdAt);
      for (const [label, text] of rowsOf(overview)) {
        expect(text, label).not.toBe('');
      }
    });
  }
});

describe('an object that says little, or is not a DaemonSet at all', () => {
  it('says nothing of a state or a count it does not hold, and no word is made up', () => {
    const overview = daemonSetOverview(record({ metadata: { name: 'x', namespace: 'n' } }));
    expect(overview.state).toBeUndefined();
    expect(overview.summary).toEqual([]);
    expect(overview.conditions).toEqual([]);
    // A DaemonSet whose template states no Node selector runs on every node, which is what it says even with no spec to read.
    expect(rowsOf(overview)).toEqual([['Node selector', 'All nodes']]);
  });

  it('keeps each field only when it has the type the API gives it', () => {
    const overview = daemonSetOverview(record({
      metadata: { name: 'x', namespace: 'n', labels: 'bad' },
      spec: { updateStrategy: 'x', selector: [], template: { spec: { serviceAccountName: 4, nodeSelector: 'x' } } },
      status: { desiredNumberScheduled: 'one', numberReady: 'one', numberMisscheduled: 'two', conditions: 'bad' },
    }));
    expect(rowsOf(overview)).toEqual([['Node selector', 'All nodes']]);
    expect(overview.summary).toEqual([]);
    expect(overview.labels).toEqual([]);
    expect(overview.conditions).toEqual([]);
  });

  it('reads an object of another shape as an empty DaemonSet, never an error', () => {
    expect(() => daemonSetOverview(record('not an object'))).not.toThrow();
    expect(rowsOf(daemonSetOverview(record(null)))).toEqual([['Node selector', 'All nodes']]);
  });
});

describe('what the definition says of its page', () => {
  it('has a page of its own, named for the Kind, whose route names the object by its namespace and its name', () => {
    expect(daemonSetDefinition.detail?.page).toBe('daemonset');
    expect(daemonSetDefinition.detail?.identity).toEqual(['namespace', 'name']);
    expect(daemonSetDefinition.detail?.overview).toBe(daemonSetOverview);
  });

  it('lays out the commands the mock lays out for a DaemonSet, every one of them offered unavailable', () => {
    expect(daemonSetDefinition.detail?.commands).toBe(daemonSetCommands);
    expect(daemonSetCommands(record(found('detail/selective').object))).toEqual({
      primary: { id: 'restart', label: 'Restart' },
      secondary: [{ id: 'logs', label: 'Logs' }],
      danger: { id: 'delete', label: 'Delete' },
      menu: [{ id: 'forward-port', label: 'Forward port…' }, { id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
    });
  });
});
