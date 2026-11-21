import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { deploymentDefinition } from './definition';
import { deploymentObject } from './object';
import { deploymentRow, deploymentSearchText, type DeploymentRow } from './row';

// The Deployment definition, as the mock's `PRINTER.Deployment` has it (MOCK k8s-resource-definitions.js:745-749; ch17 K60.3): Status, Ready, Up-to-date and Age after the name; the wide set
// (Available, Images) and the Columns chooser wait for the list page to have them.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown, key = 'row:1'): DeploymentRow => deploymentRow(hostRecord(object, key, deploymentDefinition.type));
const deployment = (spec: Record<string, unknown>, status: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) =>
  row({ metadata: { name: 'cart-api', namespace: 'checkout', creationTimestamp: '2026-11-02T20:00:00Z' }, spec, ...(status === undefined ? {} : { status }), ...extra });

const well = deployment({ replicas: 3 }, { replicas: 3, readyReplicas: 3, availableReplicas: 3, updatedReplicas: 3 });
const half = deployment({ replicas: 2 }, { replicas: 2, readyReplicas: 1, availableReplicas: 1, updatedReplicas: 2 });
const cell = (id: string, target: DeploymentRow = well) => deploymentDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(deploymentDefinition).toMatchObject({
      type: 'k8s:apps/deployments',
      identity: { group: 'apps', version: 'v1', resource: 'deployments' },
      kind: 'Deployment',
      nouns: { one: 'Deployment', other: 'Deployments' },
      page: 'deployments',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Status, Ready, Up-to-date, Age', () => {
    expect(deploymentDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['status', 'Status', false],
      ['ready', 'Ready', false],
      ['updated', 'Up-to-date', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: counts to the right, a width that holds the longest state word', () => {
    const by = Object.fromEntries(deploymentDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.status).toMatchObject({ fit: 'fixed', width: 150, align: 'left', sort: 'text' });
    expect(by.ready).toMatchObject({ fit: 'fixed', width: 59, align: 'right', sort: 'ratio' });
    expect(by.updated).toMatchObject({ fit: 'fixed', width: 90, align: 'right', sort: 'number' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has a page of one Deployment, named by its namespace and its name (the list links to it), and no tail to keep on a name that was not generated', () => {
    expect(deploymentDefinition.detail).toMatchObject({ page: 'deployment', identity: ['namespace', 'name'] });
    expect(deploymentDefinition.list.identity.tail(well)).toBe(0);
  });
});

describe('the quick filters: the four states the mock splits a workload by, each a word', () => {
  const { quickFilters } = deploymentDefinition.list;
  const matching = (target: DeploymentRow) => quickFilters.filter((filter) => filter.test(target)).map((filter) => filter.id);

  it('has them in the mock\'s order, words and tones', () => {
    expect(quickFilters.map(({ id, label, tone }) => [id, label, tone])).toEqual([
      ['available', 'Available', 'success'],
      ['progressing', 'Progressing', 'info'],
      ['partial', 'Partially ready', 'warning'],
      ['unavailable', 'Unavailable', 'error'],
    ]);
  });

  it('files each state under its own filter, and Scaled to zero and Paused under none', () => {
    expect(matching(well)).toEqual(['available']);
    expect(matching(deployment({ replicas: 2 }, { replicas: 3, readyReplicas: 2, availableReplicas: 2, updatedReplicas: 1 }))).toEqual(['progressing']);
    expect(matching(half)).toEqual(['partial']);
    expect(matching(deployment({ replicas: 2 }, { replicas: 2, updatedReplicas: 2 }))).toEqual(['unavailable']);
    expect(matching(deployment({ replicas: 0 }, {}))).toEqual([]);
    expect(matching(deployment({ replicas: 1, paused: true }, { replicas: 1, readyReplicas: 1, availableReplicas: 1, updatedReplicas: 1 }))).toEqual([]);
  });

  it('files a row that has no status in none of them', () => {
    expect(matching(row({ metadata: { name: 'x' } }))).toEqual([]);
  });
});

describe('the cells', () => {
  it('shows the name as text, and the counts as mono text', () => {
    expect(cell('name')).toEqual({ kind: 'text', text: 'cart-api' });
    expect(cell('ready')).toEqual({ kind: 'text', text: '3/3', mono: true });
    expect(cell('updated')).toEqual({ kind: 'text', text: '3', mono: true });
  });

  it('draws the state with its role: the word kept, the glyph the role\'s', () => {
    expect(cell('status')).toEqual({ kind: 'status', raw: 'Available', label: 'Available', role: 'healthy' });
    expect(cell('status', half)).toEqual({ kind: 'status', raw: 'Partially ready', label: 'Partially ready', role: 'attention' });
    expect(cell('status', deployment({ replicas: 2 }, { replicas: 2 }))).toEqual({ kind: 'status', raw: 'Unavailable', label: 'Unavailable', role: 'error' });
    expect(cell('status', deployment({ replicas: 0 }, {}))).toEqual({ kind: 'status', raw: 'Scaled to zero', label: 'Scaled to zero', role: 'stopped' });
  });

  it('watches Ready: a count below the wanted one is a state of its own, with the words in its tip (the mock\'s `watch`)', () => {
    expect(cell('ready', half)).toEqual({ kind: 'status', raw: '1/2', label: '1/2', role: 'attention', tip: '1 of 2 ready' });
    expect(cell('ready', deployment({ replicas: 0 }, {}))).toEqual({ kind: 'text', text: '0/0', mono: true });
  });

  it('shows the age in one unit, and the absolute time for the tip', () => {
    expect(cell('age')).toEqual({ kind: 'age', createdAt: Date.UTC(2026, 10, 2, 20, 0, 0), text: '17d', long: '2026-11-02 20:00 UTC · 17 days ago' });
  });

  it('shows a dash with its reason where the object states nothing, never 0 or an invented word (ch13 D7)', () => {
    const bare = row({ metadata: { name: 'crashloop' } });

    for (const id of ['ready', 'status', 'updated', 'age']) {
      expect(cell(id, bare).kind, id).toBe('none');
      expect(cell(id, bare), id).toMatchObject({ reason: expect.stringMatching(/\S/) as string });
    }
  });

  it('holds a missing count as the API\'s zero once the object has a status: kubectl prints 0 for what the status omits', () => {
    const fresh = deployment({ replicas: 2 }, {});

    expect(fresh.ready).toEqual({ ready: 0, total: 2 });
    expect(fresh.updated).toBe(0);
  });
});

describe('the row and what a person can search for', () => {
  it('derives the row once per record object, and a changed record gets a new one', () => {
    const record = hostRecord({ metadata: { name: 'a' }, spec: { replicas: 1 }, status: {} }, 'row:a', deploymentDefinition.type);
    const changed = hostRecord({ metadata: { name: 'a' }, spec: { replicas: 2 }, status: {} }, 'row:a', deploymentDefinition.type);

    expect(deploymentDefinition.model.row(record)).toBe(deploymentDefinition.model.row(record));
    expect(deploymentDefinition.model.row(changed)).not.toBe(deploymentDefinition.model.row(record));
  });

  it('holds the name, namespace, ready, state and Up-to-date in the search text, lower case', () => {
    const text = deploymentSearchText(half);

    expect(text).toContain('cart-api');
    expect(text).toContain('checkout');
    expect(text).toContain('1/2');
    expect(text).toContain('partially ready');
    expect(text).toBe(text.toLowerCase());
  });

  it('does not throw on a body that is not a Deployment: an empty identity and nothing else', () => {
    for (const body of [{}, null, 'text', 7, [], { metadata: { name: 7 } }]) {
      const decoded = row(body);

      expect(decoded).toMatchObject({ name: '', namespace: '', nameTail: 0 });
      expect(decoded.ready).toBeUndefined();
      expect(decoded.status).toBeUndefined();
    }
    expect(deploymentObject(hostRecord('text', 'row:x', deploymentDefinition.type))).toEqual({});
  });
});
