import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MASK, annotationModels } from '../detail/metadata';
import { describedFields, describedSection, parseDetailFixture, rowsOf, summaryText } from '../detail/testing';
import { hostRecord, idOf, type CapturedObject } from '../testing';

import { deploymentDefinition } from './definition';
import { deploymentCommands, deploymentOverview } from './detail';
import { deploymentRow } from './row';

// The page of a Deployment, held to the objects of a real cluster: every Deployment of the fixture (`kubectl get deployments -A -o json` on kind v1.35.0 with the slice fixture, extra-states.yaml,
// more-kinds.yaml, k2b2-kinds.yaml and k2c1-kinds.yaml; hack/kinds-capture/capture-detail.mjs), and what `kubectl describe` prints of each. The oracle of the Details card is the object, field for field as
// the definition maps it (the values are the API's, decision A19; the words are the mock's), and `describe` where a row is a derived value: the strategy in words, the selector, the counts.

/** The part of a Deployment these cases read, as `kubectl get -o json` prints it. */
type DeploymentJson = CapturedObject & {
  readonly metadata: CapturedObject['metadata'] & {
    readonly creationTimestamp: string;
    readonly generation?: number;
    readonly labels?: Readonly<Record<string, string>>;
    readonly annotations?: Readonly<Record<string, string>>;
  };
  readonly spec: { readonly replicas?: number; readonly paused?: boolean };
  readonly status: {
    readonly replicas?: number;
    readonly readyReplicas?: number;
    readonly availableReplicas?: number;
    readonly updatedReplicas?: number;
    readonly unavailableReplicas?: number;
    readonly observedGeneration?: number;
  };
};

const golden = parseDetailFixture<DeploymentJson>(readFileSync(path.join(import.meta.dirname, 'fixtures/deployments-detail.json'), 'utf8'));
const record = (object: unknown) => hostRecord(object, undefined, deploymentDefinition.type);

/** The Details card as label and text. */
const rows = (object: unknown) => rowsOf(deploymentOverview(record(object)));
const found = (id: string) => {
  const entry = golden.objects.find(({ object }) => idOf(object) === id);
  if (entry === undefined) {
    throw new Error(`the fixture has no ${id}`);
  }

  return entry;
};

describe('the Deployments the fixture holds', () => {
  it('has the ones the cases below name, and more: every state of the rule, a rollout, an autoscaled one, an annotated one', () => {
    expect(golden.objects.length).toBeGreaterThanOrEqual(20);
    for (const id of ['checkout/cart-api', 'detail/annotated', 'detail/recreating', 'kube-system/coredns', 'states/paused', 'states/scaled-zero', 'states/stuck-rollout', 'states/bad-image', 'states/half-ready']) {
      expect(golden.objects.some(({ object }) => idOf(object) === id), id).toBe(true);
    }
  });
});

describe('a Deployment that states every optional row of the Details card (detail/annotated)', () => {
  const { object } = found('detail/annotated');

  it('says the header\'s word, the one-line summary without it, and the age the object counts from', () => {
    const overview = deploymentOverview(record(object));
    expect(overview.state).toEqual({ word: 'Available', role: 'healthy' });
    expect(summaryText(overview.summary)).toEqual(['2/2 ready', 'up to date']);
    expect(overview.createdAt).toBe(Date.parse(object.metadata.creationTimestamp));
  });

  it('has each row, in the mock\'s order (K59): strategy, revision, change cause, selector, service account, revision history, progress deadline, minimum ready time', () => {
    expect(rows(object)).toEqual([
      ['Strategy', 'Rolling update · max surge 1, max unavailable 0'],
      ['Revision', '1'],
      ['Change cause', 'set image web=busybox:1.37.0 to make the page say a cause'],
      ['Selector', 'app=annotated, tier In (backend, api), canary DoesNotExist'],
      ['Service account', 'builder'],
      ['Revision history', '3 revisions'],
      ['Progress deadline', '2 min'],
      ['Minimum ready time', '5 s'],
    ]);
  });

  it('spans the whole width for the change cause and the selector, as the mock does', () => {
    const wide = deploymentOverview(record(object)).details.filter((fact) => fact.wide === true).map((fact) => fact.label);
    expect(wide).toEqual(['Change cause', 'Selector']);
  });

  it('says what the Service account is as plain text: the plugin has no page of that kind, so there is no link to nowhere', () => {
    const fact = deploymentOverview(record(object)).details.find((candidate) => candidate.label === 'Service account');
    expect(fact?.value).toMatchObject({ kind: 'ref', ref: { kind: 'ServiceAccount', name: 'builder', namespace: 'detail' }, text: 'builder' });
  });

  it('has the Available and Progressing conditions, as the object states them', () => {
    const overview = deploymentOverview(record(object));
    expect(overview.conditions.map((row) => [row.type, row.status, row.reason, row.role])).toEqual([
      ['Available', 'True', 'MinimumReplicasAvailable', 'healthy'],
      ['Progressing', 'True', 'NewReplicaSetAvailable', 'healthy'],
    ]);
  });

  it('has the labels and annotations of the object, a credential\'s value nowhere, and the last applied configuration masked', () => {
    const overview = deploymentOverview(record(object));
    expect(overview.labels.map((tag) => [tag.key, tag.value])).toEqual([['app', 'annotated'], ['tier', 'backend']]);
    expect(overview.annotations.map((tag) => [tag.key, tag.protected])).toEqual([
      ['deployment.kubernetes.io/revision', false],
      ['example.io/api-token', true],
      ['example.io/owner-team', false],
      ['kubernetes.io/change-cause', false],
    ]);
    expect(JSON.stringify(overview)).not.toContain('sentinel-deployment-token');
  });
});

describe('a Deployment made with `kubectl apply` (checkout/cart-api)', () => {
  const { object } = found('checkout/cart-api');
  const applied = 'kubectl.kubernetes.io/last-applied-configuration';

  it('has the last applied configuration among its annotations, sorted last, with its value masked and nowhere in the data', () => {
    const overview = deploymentOverview(record(object));
    expect(overview.annotations.at(-1)).toEqual({ key: applied, value: undefined, protected: true });
    const value = object.metadata.annotations?.[applied] ?? '';
    expect(value).toContain('"kind":"Deployment"');
    expect(JSON.stringify(overview)).not.toContain(value);
    expect(JSON.stringify(overview)).not.toContain('sleep 100000');
  });
});

describe('each state of the rule, as the summary says it', () => {
  const summary = (id: string) => summaryText(deploymentOverview(record(found(id).object)).summary);
  const state = (id: string) => deploymentOverview(record(found(id).object)).state?.word;

  it.each([
    ['checkout/cart-api', 'Available', ['3/3 ready', 'up to date']],
    ['states/scaled-zero', 'Scaled to zero', ['0/0 ready', 'up to date']],
    ['states/bad-image', 'Unavailable', ['0/2 ready', '2 unavailable']],
    ['states/half-ready', 'Partially ready', ['1/2 ready', '1 unavailable']],
    ['states/paused', 'Paused', ['1/1 ready', 'rollout paused']],
    // Three Pods while two are wanted: the surge of a rollout whose new Pod cannot start. kubectl says `1 unavailable`, as the API does (status.unavailableReplicas); the mock computes it from the counts.
    ['states/stuck-rollout', 'Progressing', ['2/2 ready', '1 unavailable']],
  ] as const)('%s is %s: %j', (id, word, expected) => {
    expect(state(id)).toBe(word);
    expect(summary(id)).toEqual(expected);
  });

  it('says a rollout that is behind as the Pods that are up to date, when none is unavailable', () => {
    const { object } = found('checkout/cart-api');
    const { unavailableReplicas: _, ...status } = object.status;
    const behind = { ...object, status: { ...status, updatedReplicas: 1 } };
    expect(summaryText(deploymentOverview(record(behind)).summary)).toEqual(['3/3 ready', '1 up to date']);
  });
});

describe('a status that describes an older spec: the Deployment was changed and its controller has not seen the change yet', () => {
  // `metadata.generation` counts the changes to the spec and `status.observedGeneration` is the last one the controller has seen (`kubectl rollout status` waits for them to meet). Until they do, the counts of
  // the status are of the older template, so `updatedReplicas` says nothing of the new one: the page does not say `up to date`. The counts that are facts of now (the ready ones, `unavailableReplicas`) stay.
  const { object } = found('checkout/cart-api');
  const generation = object.metadata.generation ?? 0;
  const changed = (body: DeploymentJson, over: { readonly generation?: number }) => ({ ...body, metadata: { ...body.metadata, ...over } });
  const summary = (body: unknown) => summaryText(deploymentOverview(record(body)).summary);

  it('is the real object\'s own case first: it was seen, so it is up to date', () => {
    expect(object.status.observedGeneration).toBe(generation);
    expect(summary(object)).toEqual(['3/3 ready', 'up to date']);
  });

  it('says the update is not observed yet, and not up to date, while the spec is ahead of what the controller has seen', () => {
    expect(summary(changed(object, { generation: generation + 1 }))).toEqual(['3/3 ready', 'update not observed yet']);
    expect(summary(changed(object, { generation: generation + 7 }))).toEqual(['3/3 ready', 'update not observed yet']);
  });

  it('says it of a status that has no observed generation at all: the controller has seen nothing yet', () => {
    const { observedGeneration: _, ...unobserved } = object.status;
    expect(summary({ ...object, status: unobserved })).toEqual(['3/3 ready', 'update not observed yet']);
  });

  it('is up to date again when the controller has seen the change', () => {
    expect(summary({ ...changed(object, { generation: generation + 1 }), status: { ...object.status, observedGeneration: generation + 1 } })).toEqual(['3/3 ready', 'up to date']);
  });

  it('cannot tell that an object is behind when it states no generation, and says what its counts say', () => {
    const { generation: _, ...metadata } = object.metadata;
    expect(summary({ ...object, metadata })).toEqual(['3/3 ready', 'up to date']);
  });

  it('keeps the facts of now: a pause and the Pods that are unavailable are said as before', () => {
    const paused = found('states/paused').object;
    expect(summary(changed(paused, { generation: (paused.metadata.generation ?? 0) + 1 }))).toEqual(['1/1 ready', 'rollout paused']);
    const stuck = found('states/stuck-rollout').object;
    expect(summary(changed(stuck, { generation: (stuck.metadata.generation ?? 0) + 1 }))).toEqual(['2/2 ready', '1 unavailable']);
  });
});

describe('the strategy, the selector and the counts, against `kubectl describe`', () => {
  it('says the other strategy by its name, and the mock\'s words for a rolling update, for each of the cluster\'s Deployments', () => {
    expect(rows(found('detail/recreating').object).find(([label]) => label === 'Strategy')).toEqual(['Strategy', 'Recreate']);
    expect(rows(found('kube-system/coredns').object).find(([label]) => label === 'Strategy')).toEqual(['Strategy', 'Rolling update · max surge 25%, max unavailable 1']);
  });

  for (const { object, describe: described } of golden.objects) {
    const id = idOf(object);
    const fields = described === undefined ? new Map<string, string>() : describedFields(described);

    it(`${id}: the Strategy row is describe's StrategyType and RollingUpdateStrategy`, () => {
      const strategy = rows(object).find(([label]) => label === 'Strategy')?.[1];
      const type = fields.get('StrategyType');
      if (type === 'Recreate') {
        expect(strategy).toBe('Recreate');
        return;
      }

      // `25% max unavailable, 25% max surge` or `0 max unavailable, 1 max surge`: the same two limits, in the mock's order.
      const [, unavailable, surge] = /^(\S+) max unavailable, (\S+) max surge$/.exec(fields.get('RollingUpdateStrategy') ?? '') ?? [];
      expect(type).toBe('RollingUpdate');
      expect(strategy).toBe(`Rolling update · max surge ${surge ?? '?'}, max unavailable ${unavailable ?? '?'}`);
    });

    it(`${id}: the Selector row is describe's selector, chip for chip`, () => {
      const items = deploymentOverview(record(object)).details.find((fact) => fact.label === 'Selector');
      const shown = items?.value.kind === 'tags' ? items.value.items.map((item) => (item.value === undefined ? item.key : `${item.key}=${item.value}`)) : [];
      // kubectl joins the requirements with commas, writes `!key` for DoesNotExist and `key in (a,b)` with the values sorted.
      const requirements = (fields.get('Selector') ?? '').split(/,(?![^(]*\))/);
      const normal = (text: string) => text.replace(/^!(.+)$/, '$1 DoesNotExist').replace(/ (in|notin) \(([^)]*)\)$/, (_, operator: string, values: string) => ` ${operator === 'in' ? 'In' : 'NotIn'} (${values.split(',').sort().join(', ')})`);
      const normalShown = shown.map((text) => text.replace(/ (In|NotIn) \(([^)]*)\)$/, (_, operator: string, values: string) => ` ${operator} (${values.split(', ').sort().join(', ')})`));
      expect(normalShown.sort()).toEqual(requirements.map(normal).sort());
    });

    it(`${id}: the counts of the summary are describe's Replicas line`, () => {
      const [, desired, , total, available, unavailable] = /^(\d+) desired \| (\d+) updated \| (\d+) total \| (\d+) available \| (\d+) unavailable$/.exec(fields.get('Replicas') ?? '') ?? [];
      const items = summaryText(deploymentOverview(record(object)).summary);
      expect(Number(desired)).toBe(object.spec.replicas);
      expect(Number(total)).toBe(object.status.replicas ?? 0);
      expect(Number(available)).toBe(object.status.availableReplicas ?? 0);
      // The ready count is over what is wanted, and an unavailable Pod is said when the API says one.
      expect(items[0]).toBe(`${object.status.readyReplicas ?? 0}/${desired ?? '?'} ready`);
      if (Number(unavailable) > 0 && object.spec.paused !== true) {
        expect(items[1]).toBe(`${unavailable ?? '?'} unavailable`);
      }
    });

    it(`${id}: the Minimum ready time is MinReadySeconds, only when it is more than zero; the Service account is the template's`, () => {
      const labels = rows(object).map(([label]) => label);
      const minimum = Number(fields.get('MinReadySeconds') ?? 0);
      expect(labels.includes('Minimum ready time'), id).toBe(minimum > 0);
      const account = describedSection(described ?? '', 'Pod Template').find((line) => line.startsWith('Service Account:'))?.replace(/^Service Account:\s+/, '');
      expect(rows(object).find(([label]) => label === 'Service account')?.[1]).toBe(account);
    });

    it(`${id}: the conditions are describe's table, type, status and reason`, () => {
      const shown = deploymentOverview(record(object)).conditions.map((row) => `${row.type} ${row.status} ${row.reason ?? ''}`.trim());
      const table = describedSection(described ?? '', 'Conditions').filter((line) => line !== '' && !line.startsWith('Type') && !line.startsWith('----')).map((line) => line.split(/\s+/).join(' '));
      expect(shown).toEqual(table);
    });

    it(`${id}: the labels are describe's, and the annotations are the object's with every credential and the last applied configuration masked`, () => {
      const overview = deploymentOverview(record(object));
      expect(Object.fromEntries(overview.labels.map((tag) => [tag.key, tag.value]))).toEqual(object.metadata.labels ?? {});
      expect(overview.annotations).toEqual(annotationModels(object.metadata.annotations ?? {}));
      for (const tag of overview.annotations) {
        if (tag.protected) {
          expect(tag.value, tag.key).toBeUndefined();
        }
      }
      expect(MASK).toBe('••••••••');
    });

    it(`${id}: the header says the word the list says, and no row is empty`, () => {
      const overview = deploymentOverview(record(object));
      expect(overview.state).toEqual(deploymentRow(record(object)).status);
      for (const [label, text] of rowsOf(overview)) {
        expect(text, label).not.toBe('');
      }
    });
  }
});

describe('an object that says little, or is not a Deployment at all', () => {
  it('says nothing of a state or a count it does not hold, and no word is made up', () => {
    const overview = deploymentOverview(record({ metadata: { name: 'x', namespace: 'n' } }));
    expect(overview.state).toBeUndefined();
    expect(overview.summary).toEqual([]);
    expect(overview.details).toEqual([]);
    expect(overview.conditions).toEqual([]);
  });

  it('keeps each field only when it has the type the API gives it', () => {
    const overview = deploymentOverview(record({ metadata: { name: 'x', namespace: 'n', labels: 'bad' }, spec: { replicas: 'many', strategy: 'x', selector: [], minReadySeconds: '5' }, status: { conditions: 'bad' } }));
    expect(overview.details).toEqual([]);
    expect(overview.labels).toEqual([]);
    expect(overview.conditions).toEqual([]);
  });

  it('reads an object of another shape as an empty Deployment, never an error', () => {
    expect(() => deploymentOverview(record('not an object'))).not.toThrow();
    expect(deploymentOverview(record(null)).details).toEqual([]);
  });
});

describe('what the definition says of its page', () => {
  it('has a page of its own, named for the Kind, whose route names the object by its namespace and its name', () => {
    expect(deploymentDefinition.detail?.page).toBe('deployment');
    expect(deploymentDefinition.detail?.identity).toEqual(['namespace', 'name']);
    expect(deploymentDefinition.detail?.overview).toBe(deploymentOverview);
  });

  it('lays out the commands the mock lays out for a Deployment (K59), every one of them offered unavailable', () => {
    expect(deploymentDefinition.detail?.commands).toBe(deploymentCommands);
    expect(deploymentCommands(record(found('checkout/cart-api').object))).toEqual({
      primary: { id: 'scale', label: 'Scale' },
      secondary: [{ id: 'restart', label: 'Restart' }, { id: 'logs', label: 'Logs' }],
      danger: { id: 'delete', label: 'Delete' },
      menu: [{ id: 'rollback', label: 'Roll back…' }, { id: 'pause', label: 'Pause rollout' }, { id: 'forward-port', label: 'Forward port…' }, { id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
    });
  });

  it('says Resume rollout, and not Pause rollout, while the rollout is paused', () => {
    const labels = (id: string) => deploymentCommands(record(found(id).object)).menu?.map((item) => item.label);
    expect(labels('states/paused')).toContain('Resume rollout');
    expect(labels('states/paused')).not.toContain('Pause rollout');
    expect(labels('checkout/cart-api')).toContain('Pause rollout');
    expect(labels('checkout/cart-api')).not.toContain('Resume rollout');
  });
});
