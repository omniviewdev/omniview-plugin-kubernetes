import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { daemonSetDefinition } from './definition';
import { daemonSetRow, type DaemonSetRow } from './row';

// The DaemonSet definition, as the mock's `PRINTER.DaemonSet` has it (MOCK k8s-resource-definitions.js:750-753; ch17 K60.3): Status, Desired, Ready, Up-to-date and Age after the name; the wide set
// (Available, Current, Images) and the Node selector wait for the list page to have them.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): DaemonSetRow => daemonSetRow(hostRecord(object, 'row:1', daemonSetDefinition.type));
const daemon = (status: Record<string, unknown> | undefined) =>
  row({ metadata: { name: 'node-agent', namespace: 'monitoring', creationTimestamp: '2026-11-02T20:00:00Z' }, spec: {}, ...(status === undefined ? {} : { status }) });

const well = daemon({ desiredNumberScheduled: 3, currentNumberScheduled: 3, numberReady: 3, updatedNumberScheduled: 3, numberAvailable: 3 });
const cell = (id: string, target: DaemonSetRow = well) => daemonSetDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(daemonSetDefinition).toMatchObject({
      type: 'k8s:apps/daemonsets',
      identity: { group: 'apps', version: 'v1', resource: 'daemonsets' },
      kind: 'DaemonSet',
      nouns: { one: 'DaemonSet', other: 'DaemonSets' },
      page: 'daemonsets',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Status, Desired, Ready, Up-to-date, Age', () => {
    expect(daemonSetDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['status', 'Status', false],
      ['desired', 'Desired', false],
      ['ready', 'Ready', false],
      ['updated', 'Up-to-date', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: counts to the right', () => {
    const by = Object.fromEntries(daemonSetDefinition.columns.map((column) => [column.id, column]));

    expect(by.status).toMatchObject({ fit: 'fixed', width: 150, align: 'left', sort: 'text' });
    expect(by.desired).toMatchObject({ fit: 'fixed', width: 68, align: 'right', sort: 'number' });
    expect(by.ready).toMatchObject({ fit: 'fixed', width: 59, align: 'right', sort: 'number' });
    expect(by.updated).toMatchObject({ fit: 'fixed', width: 90, align: 'right', sort: 'number' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });
});

describe('the quick filters: the same four states as the other workloads', () => {
  const { quickFilters } = daemonSetDefinition.list;
  const matching = (target: DaemonSetRow) => quickFilters.filter((filter) => filter.test(target)).map((filter) => filter.id);

  it('has them in the mock\'s order, words and tones', () => {
    expect(quickFilters.map(({ id, label, tone }) => [id, label, tone])).toEqual([
      ['available', 'Available', 'success'],
      ['progressing', 'Progressing', 'info'],
      ['partial', 'Partially ready', 'warning'],
      ['unavailable', 'Unavailable', 'error'],
    ]);
  });

  it('files each state under its own filter: a node short of ready is Partially ready, one not on the current template is Progressing', () => {
    expect(matching(well)).toEqual(['available']);
    expect(matching(daemon({ desiredNumberScheduled: 3, currentNumberScheduled: 3, numberReady: 3, updatedNumberScheduled: 1, numberAvailable: 3 }))).toEqual(['progressing']);
    expect(matching(daemon({ desiredNumberScheduled: 3, currentNumberScheduled: 3, numberReady: 2, updatedNumberScheduled: 3, numberAvailable: 2 }))).toEqual(['partial']);
    expect(matching(daemon({ desiredNumberScheduled: 3, currentNumberScheduled: 3, numberReady: 0, updatedNumberScheduled: 3 }))).toEqual(['unavailable']);
    expect(matching(daemon({ desiredNumberScheduled: 0 }))).toEqual([]);
  });
});

describe('the cells', () => {
  it('shows the counts as mono text, grouped, and the name as text', () => {
    expect(cell('name')).toEqual({ kind: 'text', text: 'node-agent' });
    expect(cell('desired')).toEqual({ kind: 'text', text: '3', mono: true });
    expect(cell('ready')).toEqual({ kind: 'text', text: '3', mono: true });
    expect(cell('updated')).toEqual({ kind: 'text', text: '3', mono: true });
    expect(cell('desired', daemon({ desiredNumberScheduled: 1204 }))).toEqual({ kind: 'text', text: '1,204', mono: true });
  });

  it('draws the state with its role', () => {
    expect(cell('status')).toEqual({ kind: 'status', raw: 'Available', label: 'Available', role: 'healthy' });
    expect(cell('status', daemon({ desiredNumberScheduled: 3, numberReady: 2, numberAvailable: 2, updatedNumberScheduled: 3 }))).toEqual({ kind: 'status', raw: 'Partially ready', label: 'Partially ready', role: 'attention' });
  });

  it('holds the counts the API omits when zero (Up-to-date, Available) as zero, and the two it never omits (Desired, Ready) as unknown when they are absent: a dash and no state word, never Scaled to zero', () => {
    expect(cell('updated', daemon({ desiredNumberScheduled: 2, numberReady: 2 }))).toEqual({ kind: 'text', text: '0', mono: true });
    expect(cell('ready', daemon({ desiredNumberScheduled: 0, numberReady: 0 }))).toEqual({ kind: 'text', text: '0', mono: true });
    const partial = daemon({ numberReady: 1, numberAvailable: 1, updatedNumberScheduled: 1 });

    expect(partial.desired).toBeUndefined();
    expect(partial.status).toBeUndefined();
    expect(daemon({ desiredNumberScheduled: 1, numberAvailable: 1 }).status).toBeUndefined();
    const bare = row({ metadata: { name: 'x' } });

    for (const id of ['desired', 'ready', 'status', 'age']) {
      expect(cell(id, bare).kind, id).toBe('none');
      expect(cell(id, bare), id).toMatchObject({ reason: expect.stringMatching(/\S/) as string });
    }
  });
});

describe('the row', () => {
  it('searches by the name, namespace, counts and state, lower case', () => {
    const text = daemonSetDefinition.model.searchText(well);

    for (const part of ['node-agent', 'monitoring', 'available']) {
      expect(text).toContain(part);
    }
    expect(text).toBe(text.toLowerCase());
  });

  it('does not throw on a body that is not a DaemonSet', () => {
    for (const body of [{}, null, 'text', 7, [], { metadata: { name: 7 } }]) {
      expect(row(body)).toMatchObject({ name: '', namespace: '', desired: undefined, ready: undefined, status: undefined });
    }
  });
});
