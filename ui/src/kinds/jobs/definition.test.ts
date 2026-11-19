import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { jobDefinition } from './definition';
import { jobRow, type JobRow } from './row';

// The Job definition, as the mock's `PRINTER.Job` has it (MOCK k8s-resource-definitions.js:769-774; ch17 K60.3): Status, Completions, Duration and Age after the name; the wide set (Images,
// Owner) and the Owner facet wait for the list page to have them.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);
const START = '2026-11-19T19:50:00Z';

const row = (object: unknown): JobRow => jobRow(hostRecord(object, 'row:1', jobDefinition.type));
const job = (spec: Record<string, unknown>, status: Record<string, unknown> | undefined) =>
  row({ metadata: { name: 'ledger-backup-29908440', namespace: 'payments', creationTimestamp: '2026-11-19T19:50:00Z' }, spec, ...(status === undefined ? {} : { status }) });
const condition = (type: string) => ({ conditions: [{ type, status: 'True' }] });

const running = job({ completions: 1, parallelism: 1 }, { startTime: START, active: 1 });
const complete = job({ completions: 1, parallelism: 1 }, { startTime: START, completionTime: '2026-11-19T19:57:36Z', succeeded: 1, ...condition('Complete') });
const failed = job({ completions: 1, parallelism: 1 }, { startTime: START, failed: 1, ...condition('Failed') });
const suspended = job({ completions: 1, suspend: true }, { ...condition('Suspended') });
const cell = (id: string, target: JobRow = complete) => jobDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(jobDefinition).toMatchObject({
      type: 'k8s:batch/jobs',
      identity: { group: 'batch', version: 'v1', resource: 'jobs' },
      kind: 'Job',
      nouns: { one: 'Job', other: 'Jobs' },
      page: 'jobs',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Status, Completions, Duration, Age', () => {
    expect(jobDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['status', 'Status', false],
      ['completions', 'Completions', false],
      ['duration', 'Duration', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: counts and spans to the right', () => {
    const by = Object.fromEntries(jobDefinition.columns.map((column) => [column.id, column]));

    expect(by.status).toMatchObject({ fit: 'fixed', width: 107, align: 'left', sort: 'text' });
    expect(by.completions).toMatchObject({ fit: 'fixed', width: 98, align: 'right', sort: 'ratio' });
    expect(by.duration).toMatchObject({ fit: 'fixed', width: 94, align: 'right', sort: 'number' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('keeps the end of a generated name whole: a Job\'s schedule time, the mock\'s `ledger-backup-29908440`', () => {
    expect(jobDefinition.list.identity.tail(complete)).toBe('-29908440'.length);
  });

  it('has no detail page yet', () => {
    expect(jobDefinition.detail).toBeUndefined();
  });
});

describe('the quick filters: the four states of a Job, each a word kubectl prints', () => {
  const { quickFilters } = jobDefinition.list;
  const matching = (target: JobRow) => quickFilters.filter((filter) => filter.test(target)).map((filter) => filter.id);

  it('has them in the mock\'s order, words and tones', () => {
    expect(quickFilters.map(({ id, label, tone }) => [id, label, tone])).toEqual([
      ['running', 'Running', 'info'],
      ['complete', 'Complete', 'success'],
      ['failed', 'Failed', 'error'],
      ['suspended', 'Suspended', 'muted'],
    ]);
  });

  it('files each state under its own filter', () => {
    expect(matching(running)).toEqual(['running']);
    expect(matching(complete)).toEqual(['complete']);
    expect(matching(failed)).toEqual(['failed']);
    expect(matching(suspended)).toEqual(['suspended']);
  });

  it('files a row that has no state in none of them', () => {
    expect(matching(row({ metadata: { name: 'x' } }))).toEqual([]);
  });
});

describe('the state: kubectl v1.35\'s printJob, branch by branch', () => {
  const deleting = (status: Record<string, unknown>) =>
    row({ metadata: { name: 'x', namespace: 'ns', deletionTimestamp: '2026-11-19T20:00:00Z' }, spec: { completions: 1 }, status });

  it('is Complete, else Failed: the first of those conditions that is true', () => {
    expect(job({ completions: 1 }, { conditions: [{ type: 'Failed', status: 'True' }, { type: 'Complete', status: 'True' }] }).status?.word).toBe('Complete');
    expect(job({ completions: 1 }, condition('Failed')).status?.word).toBe('Failed');
  });

  it('is Terminating while the Job is being deleted, after a terminal condition and before the others', () => {
    expect(deleting({}).status?.word).toBe('Terminating');
    expect(deleting(condition('Suspended')).status?.word).toBe('Terminating');
    expect(deleting(condition('Failed')).status?.word).toBe('Failed');
    expect(deleting(condition('Complete')).status?.word).toBe('Complete');
  });

  it('is Suspended by its condition only: a request to suspend (spec.suspend) is Running until the controller says so', () => {
    expect(job({ completions: 1 }, condition('Suspended')).status?.word).toBe('Suspended');
    expect(job({ completions: 1, suspend: true }, {}).status?.word).toBe('Running');
  });

  it('says FailureTarget and SuccessCriteriaMet while a Job finishes, as kubectl does, and Running for a Job that has none of these', () => {
    expect(job({ completions: 1 }, condition('FailureTarget')).status?.word).toBe('FailureTarget');
    expect(job({ completions: 1 }, condition('SuccessCriteriaMet')).status?.word).toBe('SuccessCriteriaMet');
    expect(job({ completions: 1 }, {}).status?.word).toBe('Running');
    expect(job({ completions: 1 }, { conditions: [{ type: 'Failed', status: 'False' }] }).status?.word).toBe('Running');
  });

  it('draws each word with its role: Running running, Complete healthy, Failed error, Suspended stopped, Terminating progress, and the two transient words with none', () => {
    expect([running, complete, failed, suspended, deleting({})].map((target) => target.status?.role)).toEqual(['running', 'healthy', 'error', 'stopped', 'progress']);
    expect(job({ completions: 1 }, condition('FailureTarget')).status?.role).toBeUndefined();
  });

  it('files the transient words in All and in no filter', () => {
    const matching = (target: JobRow) => jobDefinition.list.quickFilters.filter((filter) => filter.test(target)).map((filter) => filter.id);
    expect(matching(job({ completions: 1 }, condition('FailureTarget')))).toEqual([]);
    expect(matching(deleting({}))).toEqual([]);
  });
});

describe('the cells', () => {
  it('shows Completions as mono text: succeeded over wanted, a missing count as the API\'s zero, one wanted when no count is set', () => {
    expect(cell('completions')).toEqual({ kind: 'text', text: '1/1', mono: true });
    expect(cell('completions', running)).toEqual({ kind: 'text', text: '0/1', mono: true });
    expect(cell('completions', job({}, {}))).toEqual({ kind: 'text', text: '0/1', mono: true });
  });

  it('says "of N" when no count is set and N run at a time, as kubectl prints a work queue', () => {
    expect(cell('completions', job({ parallelism: 2 }, { succeeded: 2 }))).toEqual({ kind: 'text', text: '2/1 of 2', mono: true });
    expect(cell('completions', job({ parallelism: 1 }, { succeeded: 1 }))).toEqual({ kind: 'text', text: '1/1', mono: true });
    expect(cell('completions', job({ completions: 5, parallelism: 2 }, { succeeded: 3 }))).toEqual({ kind: 'text', text: '3/5', mono: true });
  });

  it('shows the span of a Job that finished, in the mock\'s human units', () => {
    expect(cell('duration')).toEqual({ kind: 'text', text: '7 min 36 s' });
  });

  it('keeps counting for a Job that has not finished, from its start (a Failed Job has no completion time either)', () => {
    expect(cell('duration', running)).toEqual({ kind: 'elapsed', since: Date.UTC(2026, 10, 19, 19, 50, 0), text: '10 min' });
    expect(cell('duration', failed)).toMatchObject({ kind: 'elapsed', text: '10 min' });
  });

  it('shows a dash with its reason for a Job that has not started', () => {
    expect(cell('duration', suspended)).toMatchObject({ kind: 'none', reason: expect.stringMatching(/\S/) as string });
  });

  it('draws the state with its role, and the age in one unit with the time in the tip', () => {
    expect(cell('status')).toEqual({ kind: 'status', raw: 'Complete', label: 'Complete', role: 'healthy' });
    expect(cell('status', failed)).toEqual({ kind: 'status', raw: 'Failed', label: 'Failed', role: 'error' });
    expect(cell('age')).toEqual({ kind: 'age', createdAt: Date.UTC(2026, 10, 19, 19, 50, 0), text: '10m', long: '2026-11-19 19:50 UTC · 10 minutes ago' });
  });

  it('shows a dash with its reason where the object states nothing, never an invented word (ch13 D7)', () => {
    const bare = row({ metadata: { name: 'x' } });

    for (const id of ['status', 'completions', 'duration', 'age']) {
      expect(cell(id, bare).kind, id).toBe('none');
      expect(cell(id, bare), id).toMatchObject({ reason: expect.stringMatching(/\S/) as string });
    }
  });
});

describe('the row', () => {
  it('sorts Duration by the span: the finished ones by their length, the running ones by the time since their start', () => {
    const value = jobDefinition.fields.find((field) => field.id === 'duration')!.sortValue;

    expect(value(complete)).toBe(456);
    expect(value(suspended)).toBeUndefined();
    expect(typeof value(running)).toBe('number');
  });

  it('searches by the name, namespace, state and completions, lower case', () => {
    const text = jobDefinition.model.searchText(complete);

    for (const part of ['ledger-backup-29908440', 'payments', 'complete', '1/1']) {
      expect(text).toContain(part);
    }
    expect(text).toBe(text.toLowerCase());
  });

  it('does not throw on a body that is not a Job', () => {
    for (const body of [{}, null, 'text', 7, [], { metadata: { name: 7 } }]) {
      expect(row(body)).toMatchObject({ name: '', namespace: '', status: undefined, completions: undefined, startedAt: undefined });
    }
  });
});
