import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { cronJobDefinition } from './definition';
import { cronJobRow, cronJobSearchText, type CronJobRow } from './row';

// The CronJob definition, as the mock's `PRINTER.CronJob` has it (MOCK k8s-resource-definitions.js:762-766; ch17 K60.3): after the name, Schedule, Status, Active, Last schedule and Age. The wide set
// (Suspend, Time zone) and the Columns chooser's wait for the list page to have them. The state is the mock's: Active, or Suspended when `spec.suspend` says so.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): CronJobRow => cronJobRow(hostRecord(object, 'row:1', cronJobDefinition.type));
const cronJob = (spec: Record<string, unknown> | undefined, status: Record<string, unknown> | undefined) =>
  row({ metadata: { name: 'ledger-backup', namespace: 'payments', creationTimestamp: '2026-11-10T20:00:00Z' }, ...(spec === undefined ? {} : { spec }), ...(status === undefined ? {} : { status }) });

const running = cronJob({ schedule: '0 */6 * * *', suspend: false }, { lastScheduleTime: '2026-11-19T18:00:00Z', active: [{ kind: 'Job', name: 'ledger-backup-29908440' }] });
const suspended = cronJob({ schedule: '15 * * * *', suspend: true }, { lastScheduleTime: '2026-11-19T19:15:00Z' });
const never = cronJob({ schedule: '0 0 1 1 *', suspend: false }, {});
const cell = (id: string, target: CronJobRow = running) => cronJobDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(cronJobDefinition).toMatchObject({
      type: 'k8s:batch/cronjobs',
      identity: { group: 'batch', version: 'v1', resource: 'cronjobs' },
      kind: 'CronJob',
      nouns: { one: 'CronJob', other: 'CronJobs' },
      page: 'cronjobs',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Schedule, Status, Active, Last schedule, Age', () => {
    expect(cronJobDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['schedule', 'Schedule', false],
      ['status', 'Status', false],
      ['active', 'Active', false],
      ['lastSchedule', 'Last schedule', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: the schedule takes what is left, a width that holds the longest state word, counts to the right, times to the left', () => {
    const by = Object.fromEntries(cronJobDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.schedule).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.status).toMatchObject({ fit: 'fixed', width: 107, align: 'left', sort: 'text' });
    expect(by.active).toMatchObject({ fit: 'fixed', width: 59, align: 'right', sort: 'number' });
    expect(by.lastSchedule).toMatchObject({ fit: 'fixed', width: 120, align: 'left', sort: 'time' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('keeps no tail on a name that was not generated, and has a detail page', () => {
    expect(cronJobDefinition.list.identity.tail(running)).toBe(0);
    expect(cronJobDefinition.detail).toMatchObject({ page: 'cronjob', identity: ['namespace', 'name'] });
  });
});

describe('the quick filters: the two states of a CronJob, each a word', () => {
  const { quickFilters } = cronJobDefinition.list;
  const matching = (target: CronJobRow) => quickFilters.filter((filter) => filter.test(target)).map((filter) => filter.id);

  it('has them in the mock\'s order, words and tones', () => {
    expect(quickFilters.map(({ id, label, tone }) => [id, label, tone])).toEqual([
      ['active', 'Active', 'success'],
      ['suspended', 'Suspended', 'muted'],
    ]);
  });

  it('files each state under its own filter, and a row that has no state in none', () => {
    expect(matching(running)).toEqual(['active']);
    expect(matching(never)).toEqual(['active']);
    expect(matching(suspended)).toEqual(['suspended']);
    expect(matching(row({ metadata: { name: 'x' } }))).toEqual([]);
  });
});

describe('the row: what the object states', () => {
  it('reads the schedule, the number of Jobs running and when it last ran', () => {
    expect(running).toMatchObject({ name: 'ledger-backup', namespace: 'payments', schedule: '0 */6 * * *', active: 1, lastScheduleAt: Date.UTC(2026, 10, 19, 18, 0, 0) });
  });

  it('is Active unless the spec suspends it, and Suspended when it does', () => {
    expect(running.status).toEqual({ word: 'Active', role: 'healthy' });
    expect(suspended.status).toEqual({ word: 'Suspended', role: 'stopped' });
    expect(cronJob({ schedule: '0 * * * *' }, {}).status?.word).toBe('Active');
  });

  it('reads Active as the API\'s zero when the status holds no Job (the API omits an empty list, and kubectl prints 0), and the last schedule as unknown until it has run', () => {
    expect(never).toMatchObject({ active: 0, lastScheduleAt: undefined });
    expect(suspended.active).toBe(0);
  });

  it('says nothing of the state for an object with no spec, and nothing of the Jobs for one with no status: dashes, never a word or a zero made up', () => {
    const bare = cronJob(undefined, undefined);
    expect(bare).toMatchObject({ schedule: undefined, status: undefined, active: undefined, lastScheduleAt: undefined });
  });

  it('searches the name, the namespace, the schedule and the word', () => {
    const text = cronJobSearchText(running);
    expect(text).toContain('ledger-backup');
    expect(text).toContain('payments');
    expect(text).toContain('0 */6 * * *');
    expect(text).toContain('active');
  });
});

describe('the cells', () => {
  it('draws the schedule as it is written, the word with its role, and the active Jobs as a count', () => {
    expect(cell('schedule')).toEqual({ kind: 'text', text: '0 */6 * * *' });
    expect(cell('status')).toEqual({ kind: 'status', raw: 'Active', label: 'Active', role: 'healthy' });
    expect(cell('status', suspended)).toEqual({ kind: 'status', raw: 'Suspended', label: 'Suspended', role: 'stopped' });
    expect(cell('active')).toEqual({ kind: 'text', text: '1', mono: true });
    expect(cell('active', never)).toEqual({ kind: 'text', text: '0', mono: true });
  });

  it('draws the last schedule as an age, and a dash that says why for a CronJob that has not run', () => {
    expect(cell('lastSchedule')).toMatchObject({ kind: 'age', text: '2h' });
    expect(cell('lastSchedule', never)).toEqual({ kind: 'none', reason: 'The CronJob has not run yet.' });
  });

  it('draws a dash that says why for what the object does not state', () => {
    const bare = cronJob(undefined, undefined);
    expect(cell('schedule', bare)).toEqual({ kind: 'none', reason: 'The CronJob states no schedule.' });
    expect(cell('status', bare)).toEqual({ kind: 'none', reason: 'The CronJob states no schedule.' });
    expect(cell('active', bare)).toEqual({ kind: 'none', reason: 'The CronJob reports no status yet.' });
  });

  it('sorts by the schedule, the word, the number of Jobs, and the times', () => {
    const sortOf = (id: string, target: CronJobRow = running) => cronJobDefinition.fields.find((field) => field.id === id)!.sortValue(target);
    expect([sortOf('schedule'), sortOf('status'), sortOf('active')]).toEqual(['0 */6 * * *', 'Active', 1]);
    expect(sortOf('lastSchedule')).toBe(Date.UTC(2026, 10, 19, 18, 0, 0));
    expect(sortOf('lastSchedule', never)).toBeUndefined();
    expect(sortOf('age')).toBe(Date.UTC(2026, 10, 10, 20, 0, 0));
  });
});
