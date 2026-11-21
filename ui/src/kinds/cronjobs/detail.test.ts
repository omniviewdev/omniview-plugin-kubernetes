import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MASK, annotationModels } from '../detail/metadata';
import { describedFields, parseDetailFixture, rowsOf, summaryText } from '../detail/testing';
import { hostRecord, idOf, type CapturedObject } from '../testing';

import { cronJobDefinition } from './definition';
import { cronJobCommands, cronJobOverview } from './detail';
import { cronJobRow } from './row';

// The page of a CronJob, held to the objects of a real cluster: every CronJob of the fixture (`kubectl get cronjobs -A -o json` on kind v1.35.0; hack/kinds-capture/capture-detail.mjs), and what `kubectl
// describe` prints of each. The oracle of the Details card is the object, field for field as the definition maps it (the values are the API's, decision A19; the words are the mock's), and `describe` where a
// row is a value kubectl prints too: the schedule, the policy, the history limits, the last schedule and the active Jobs.

/** The part of a CronJob these cases read, as `kubectl get -o json` prints it. */
type CronJobJson = CapturedObject & {
  readonly metadata: CapturedObject['metadata'] & {
    readonly creationTimestamp: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly annotations?: Readonly<Record<string, string>>;
  };
  readonly spec: {
    readonly schedule: string;
    readonly timeZone?: string;
    readonly suspend?: boolean;
    readonly concurrencyPolicy?: string;
    readonly successfulJobsHistoryLimit?: number;
    readonly failedJobsHistoryLimit?: number;
  };
  readonly status: { readonly lastScheduleTime?: string; readonly active?: ReadonlyArray<{ readonly name: string }> };
};

const golden = parseDetailFixture<CronJobJson>(readFileSync(path.join(import.meta.dirname, 'fixtures/cronjobs-detail.json'), 'utf8'));
const record = (object: unknown) => hostRecord(object, undefined, cronJobDefinition.type);

/** The Details card as label and text. */
const rows = (object: unknown) => rowsOf(cronJobOverview(record(object)));
const found = (id: string) => {
  const entry = golden.objects.find(({ object }) => idOf(object) === id);
  if (entry === undefined) {
    throw new Error(`the fixture has no ${id}`);
  }

  return entry;
};

describe('the CronJobs the fixture holds', () => {
  it('has the ones the cases below name: one with a time zone, one that is running a Job, one that has never run, a suspended one', () => {
    for (const id of ['detail/every-quarter', 'detail/office-hours', 'more/done', 'more/forbid', 'more/never', 'more/suspended']) {
      expect(golden.objects.some(({ object }) => idOf(object) === id), id).toBe(true);
    }
  });
});

describe('a CronJob that states every optional row of the Details card (more/forbid, with a zone from detail/every-quarter)', () => {
  it('says the header\'s word and the age the object counts from, and has no summary: the mock\'s `next run` needs a clock and a cron evaluator', () => {
    const { object } = found('more/forbid');
    const overview = cronJobOverview(record(object));
    expect(overview.state).toEqual({ word: 'Active', role: 'healthy' });
    expect(overview.summary).toEqual([]);
    expect(overview.createdAt).toBe(Date.parse(object.metadata.creationTimestamp));
  });

  it('has each row, in the mock\'s order: schedule in words, the expression, zone, policy, last schedule, active Jobs, history limits', () => {
    const { object } = found('detail/every-quarter');
    expect(rows(object)).toEqual([
      ['Schedule', 'Every 15 minutes'],
      ['Cron expression', '*/15 * * * *'],
      ['Time zone', 'Europe/Paris'],
      ['Concurrency policy', 'Replace'],
      ['Active Jobs', '0'],
      ['History limits', '5 successful · 2 failed'],
    ]);
    expect(rows(found('more/forbid').object)).toEqual([
      ['Schedule', 'Every minute'],
      ['Cron expression', '*/1 * * * *'],
      ['Concurrency policy', 'Forbid'],
      ['Last schedule', `at ${new Date(Date.parse('2026-11-21T08:24:00Z')).toISOString()}`],
      ['Active Jobs', '1'],
      ['History limits', '3 successful · 1 failed'],
    ]);
  });

  it('keeps the schedule in words as the tip of the expression, and a schedule it has no words for as the expression itself, in mono, with no second row', () => {
    const words = cronJobOverview(record(found('more/suspended').object)).details.find((fact) => fact.id === 'schedule');
    expect(words?.value).toEqual({ kind: 'text', text: 'Every day at 03:00', tip: '0 3 * * *' });
    const odd = cronJobOverview(record(found('detail/office-hours').object));
    expect(odd.details.find((fact) => fact.id === 'schedule')?.value).toEqual({ kind: 'text', text: '0 9-17 * * 1-5', mono: true });
    expect(odd.details.some((fact) => fact.id === 'cron')).toBe(false);
  });

  it('draws the Cron expression in mono, the last schedule as a moment, and no row for a zone, a last schedule or a history the object does not state', () => {
    const overview = cronJobOverview(record(found('more/forbid').object));
    expect(overview.details.find((fact) => fact.id === 'cron')?.value).toMatchObject({ kind: 'text', mono: true });
    expect(overview.details.find((fact) => fact.id === 'last')?.value).toEqual({ kind: 'moment', at: Date.parse('2026-11-21T08:24:00Z') });
    expect(overview.details.some((fact) => fact.id === 'zone')).toBe(false);
    const bare = rows({ metadata: { name: 'x' }, spec: { schedule: '0 0 * * *', successfulJobsHistoryLimit: 3 }, status: {} });
    expect(bare.map(([label]) => label)).toEqual(['Schedule', 'Cron expression', 'Active Jobs']);
  });

  it('says Active Jobs as the count of what the status lists: 0 for a status that lists none, and no row for an object that has no status', () => {
    expect(rows(found('more/never').object).find(([label]) => label === 'Active Jobs')).toEqual(['Active Jobs', '0']);
    expect(rows({ metadata: { name: 'x' }, spec: { schedule: '0 0 * * *' } }).map(([label]) => label)).not.toContain('Active Jobs');
  });

  it('has no conditions: a CronJob has none, even when a body states some', () => {
    const { object } = found('more/forbid');
    expect(cronJobOverview(record(object)).conditions).toEqual([]);
    expect(cronJobOverview(record({ ...object, status: { ...object.status, conditions: [{ type: 'Ready', status: 'True' }] } })).conditions).toEqual([]);
  });
});

describe('an annotated CronJob', () => {
  it('has the labels and annotations of the object, a credential\'s value nowhere, and the last applied configuration masked', () => {
    const { object } = found('more/forbid');
    const applied = 'kubectl.kubernetes.io/last-applied-configuration';
    const annotated = { ...object, metadata: { ...object.metadata, annotations: { [applied]: '{"kind":"CronJob","sentinel":"sentinel-applied"}', 'example.io/api-token': 'sentinel-cronjob-token', 'example.io/owner-team': 'payments' } } };
    const overview = cronJobOverview(record(annotated));
    expect(overview.annotations.map((tag) => [tag.key, tag.protected])).toEqual([['example.io/api-token', true], ['example.io/owner-team', false], [applied, true]]);
    expect(JSON.stringify(overview)).not.toContain('sentinel-cronjob-token');
    expect(JSON.stringify(overview)).not.toContain('sentinel-applied');
  });
});

describe('every CronJob of the fixture, against `kubectl describe` and the object', () => {
  for (const { object, describe: described } of golden.objects) {
    const id = idOf(object);
    const fields = described === undefined ? new Map<string, string>() : describedFields(described);
    const shown = (label: string) => rows(object).find(([name]) => name === label)?.[1];

    it(`${id}: the Cron expression is describe's Schedule, and the Concurrency policy and the History limits are describe's`, () => {
      expect(cronJobOverview(record(object)).details.find((fact) => fact.id === 'cron' || (fact.id === 'schedule' && fact.value.kind === 'text' && fact.value.mono === true))?.value).toMatchObject({ text: fields.get('Schedule') });
      expect(shown('Concurrency policy')).toBe(fields.get('Concurrency Policy'));
      expect(shown('History limits')).toBe(`${fields.get('Successful Job History Limit')} successful · ${fields.get('Failed Job History Limit')} failed`);
    });

    it(`${id}: the Last schedule is describe's Last Schedule Time, and a row only when the CronJob has run`, () => {
      const unset = fields.get('Last Schedule Time') === '<unset>';
      expect(shown('Last schedule') !== undefined, id).toBe(!unset);
      if (!unset) {
        expect(Date.parse(fields.get('Last Schedule Time') ?? '')).toBe(Date.parse(object.status.lastScheduleTime ?? ''));
        expect(shown('Last schedule')).toBe(`at ${new Date(Date.parse(object.status.lastScheduleTime ?? '')).toISOString()}`);
      }
    });

    it(`${id}: the Active Jobs are the count of the Jobs describe names, and the Time zone is the object's`, () => {
      const active = fields.get('Active Jobs') ?? '';
      expect(shown('Active Jobs')).toBe(String(active === '<none>' ? 0 : active.split(',').length));
      expect(shown('Time zone')).toBe(object.spec.timeZone);
    });

    it(`${id}: the header says the word the list says (Suspend is ${fields.get('Suspend') ?? '?'}), and no row is empty`, () => {
      const overview = cronJobOverview(record(object));
      expect(overview.state).toEqual(cronJobRow(record(object)).status);
      expect(overview.state?.word).toBe(fields.get('Suspend') === 'True' ? 'Suspended' : 'Active');
      for (const [label, text] of rowsOf(overview)) {
        expect(text, label).not.toBe('');
      }
    });

    it(`${id}: the labels are the object's, the annotations masked as the shared rule says`, () => {
      const overview = cronJobOverview(record(object));
      expect(Object.fromEntries(overview.labels.map((tag) => [tag.key, tag.value]))).toEqual(object.metadata.labels ?? {});
      expect(overview.annotations).toEqual(annotationModels(object.metadata.annotations ?? {}));
      expect(MASK).toBe('••••••••');
    });
  }
});

describe('an object that says little, or is not a CronJob at all', () => {
  it('says nothing of a state, a schedule or a count it does not hold, and no word is made up', () => {
    const overview = cronJobOverview(record({ metadata: { name: 'x', namespace: 'n' } }));
    expect(overview.state).toBeUndefined();
    expect(overview.summary).toEqual([]);
    expect(overview.details).toEqual([]);
    expect(overview.conditions).toEqual([]);
  });

  it('keeps each field only when it has the type the API gives it, and a history only when both limits are stated', () => {
    const overview = cronJobOverview(record({ metadata: { name: 'x', namespace: 'n', labels: 'bad' }, spec: { schedule: 5, timeZone: 1, concurrencyPolicy: [], successfulJobsHistoryLimit: 'many', failedJobsHistoryLimit: 1 }, status: { active: 'x', lastScheduleTime: 4 } }));
    expect(overview.details.map((fact) => fact.id)).toEqual(['active']);
    expect(overview.labels).toEqual([]);
  });

  it('reads an object of another shape as an empty CronJob, never an error', () => {
    expect(() => cronJobOverview(record('not an object'))).not.toThrow();
    expect(cronJobOverview(record(null)).details).toEqual([]);
    expect(summaryText(cronJobOverview(record([])).summary)).toEqual([]);
  });
});

describe('what the definition says of its page', () => {
  it('has a page of its own, named for the Kind, whose route names the object by its namespace and its name', () => {
    expect(cronJobDefinition.detail?.page).toBe('cronjob');
    expect(cronJobDefinition.detail?.identity).toEqual(['namespace', 'name']);
    expect(cronJobDefinition.detail?.overview).toBe(cronJobOverview);
  });

  it('lays out the commands the mock lays out for a CronJob (K59): Run now, Suspend, Delete and the menu, every one offered unavailable', () => {
    expect(cronJobDefinition.detail?.commands).toBe(cronJobCommands);
    expect(cronJobCommands(record(found('more/forbid').object))).toEqual({
      primary: { id: 'run-now', label: 'Run now' },
      secondary: [{ id: 'suspend', label: 'Suspend' }],
      danger: { id: 'delete', label: 'Delete' },
      menu: [{ id: 'logs', label: 'Logs' }, { id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
    });
  });

  it('says Resume, and not Suspend, while the CronJob is suspended', () => {
    expect(cronJobCommands(record(found('more/suspended').object)).secondary).toEqual([{ id: 'resume', label: 'Resume' }]);
  });
});
