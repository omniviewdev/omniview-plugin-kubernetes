import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { annotationModels } from '../detail/metadata';
import { describedFields, parseDetailFixture, rowsOf, summaryText } from '../detail/testing';
import { spanText } from '../fields';
import { hostRecord, idOf, kubectlSeconds, type CapturedObject } from '../testing';

import { jobDefinition } from './definition';
import { jobCommands, jobOverview } from './detail';
import { jobRow } from './row';

// The page of a Job, held to the objects of a real cluster: every Job of the fixture (`kubectl get jobs -A -o json` on kind v1.35.0; hack/kinds-capture/capture-detail.mjs) and what `kubectl describe`
// prints of each. The oracle of the Details card is the object, field for field as the definition maps it (the values are the API's, decision A19; the words are the mock's), and `describe` where a row
// is a derived value: the counts, the time limit, the clean-up, the owner and the time a finished Job took.

/** The part of a Job these cases read, as `kubectl get -o json` prints it. */
type JobJson = CapturedObject & {
  readonly metadata: CapturedObject['metadata'] & {
    readonly creationTimestamp: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly annotations?: Readonly<Record<string, string>>;
    readonly ownerReferences?: ReadonlyArray<{ readonly kind: string; readonly name: string; readonly controller?: boolean }>;
  };
  readonly spec: {
    readonly completions?: number;
    readonly parallelism?: number;
    readonly backoffLimit?: number;
    readonly activeDeadlineSeconds?: number;
    readonly ttlSecondsAfterFinished?: number;
  };
  readonly status: {
    readonly succeeded?: number;
    readonly startTime?: string;
    readonly completionTime?: string;
    readonly conditions?: ReadonlyArray<{ readonly type: string; readonly status: string; readonly reason?: string }>;
  };
};

const golden = parseDetailFixture<JobJson>(readFileSync(path.join(import.meta.dirname, 'fixtures/jobs-detail.json'), 'utf8'));
const record = (object: unknown) => hostRecord(object, undefined, jobDefinition.type);

/** The Details card as label and text. */
const rows = (object: unknown) => rowsOf(jobOverview(record(object)));
const found = (id: string) => {
  const entry = golden.objects.find(({ object }) => idOf(object) === id);
  if (entry === undefined) {
    throw new Error(`the fixture has no ${id}`);
  }

  return entry;
};
const summary = (object: unknown) => summaryText(jobOverview(record(object)).summary);
const at = (stamp: string) => Date.parse(stamp);

describe('the Jobs the fixture holds', () => {
  it('has the ones the cases below name: every state of the rule, one with a time limit and a clean-up, two a CronJob made', () => {
    for (const id of ['batch/broken-migration', 'batch/nightly-report', 'detail/limited', 'more/done-29920824', 'more/forbid-29920824', 'states/deadline', 'states/indexed', 'states/running', 'states/suspended', 'states/work-queue']) {
      expect(golden.objects.some(({ object }) => idOf(object) === id), id).toBe(true);
    }
  });
});

describe('a Job that states every optional row of the Details card (detail/limited)', () => {
  const { object } = found('detail/limited');

  it('says the header\'s word, how long it took, and the age the object counts from', () => {
    const overview = jobOverview(record(object));
    expect(overview.state).toEqual({ word: 'Complete', role: 'healthy' });
    expect(summaryText(overview.summary)).toEqual(['took 4 s']);
    expect(overview.createdAt).toBe(at(object.metadata.creationTimestamp));
  });

  it('has each row it states, in the mock\'s order: completions, parallelism, backoff limit, time limit, cleaned up', () => {
    expect(rows(object)).toEqual([
      ['Completions', '1/1'],
      ['Parallelism', '1'],
      ['Backoff limit', '2'],
      ['Time limit', '1 h'],
      ['Cleaned up', '1 d after it finishes'],
    ]);
  });

  it('has the conditions the object states, the success criteria and the completion', () => {
    expect(jobOverview(record(object)).conditions.map((row) => [row.type, row.status, row.reason])).toEqual([
      ['SuccessCriteriaMet', 'True', 'CompletionsReached'],
      ['Complete', 'True', 'CompletionsReached'],
    ]);
  });
});

describe('each state of the rule, as the summary and the rows say it', () => {
  it('says a Job that runs by what it has done of what it wants, and for how long it has run', () => {
    const { object } = found('states/running');
    expect(jobOverview(record(object)).state).toEqual({ word: 'Running', role: 'running' });
    expect(summary(object)).toEqual(['0/1 completions']);
    expect(jobOverview(record(object)).details.map((fact) => [fact.label, fact.value])).toEqual([
      ['Completions', { kind: 'text', text: '0/1' }],
      ['Parallelism', { kind: 'text', text: '1' }],
      ['Backoff limit', { kind: 'text', text: '6' }],
      ['Duration', { kind: 'running', since: at('2026-11-21T08:23:18Z') }],
    ]);
  });

  it('says the failure of a Job by the reason of its Failed condition: the backoff limit, the deadline', () => {
    expect(jobOverview(record(found('batch/broken-migration').object)).state?.word).toBe('Failed');
    expect(summary(found('batch/broken-migration').object)).toEqual(['backoff limit reached']);
    expect(rows(found('batch/broken-migration').object)).toEqual([['Completions', '0/1'], ['Parallelism', '1'], ['Backoff limit', '0']]);
    expect(jobOverview(record(found('states/deadline').object)).state?.word).toBe('Failed');
    expect(summary(found('states/deadline').object)).toEqual(['deadline exceeded']);
    expect(rows(found('states/deadline').object)).toEqual([['Completions', '0/1'], ['Parallelism', '1'], ['Backoff limit', '0'], ['Time limit', '5 s']]);
  });

  it('says a reason the mock has no words for as the API spells it, and nothing for a failure that states none', () => {
    const { object } = found('batch/broken-migration');
    const failed = (conditions: unknown) => summary({ ...object, status: { ...object.status, conditions } });
    expect(failed([{ type: 'Failed', status: 'True', reason: 'PodFailurePolicy' }])).toEqual(['PodFailurePolicy']);
    expect(failed([{ type: 'Failed', status: 'True' }])).toEqual([]);
    // Only the Failed condition that holds says the reason: the FailureTarget one that comes before it does not.
    expect(failed([{ type: 'FailureTarget', status: 'True', reason: 'BackoffLimitExceeded' }, { type: 'Failed', status: 'True', reason: 'DeadlineExceeded' }])).toEqual(['deadline exceeded']);
  });

  it('says nothing of a Job that is suspended, nor of one that is finishing: the chip says the word', () => {
    const suspended = found('states/suspended').object;
    expect(jobOverview(record(suspended)).state?.word).toBe('Suspended');
    expect(summary(suspended)).toEqual([]);
    expect(rows(suspended)).toEqual([['Completions', '0/1'], ['Parallelism', '1'], ['Backoff limit', '6']]);
    const { object } = found('batch/nightly-report');
    for (const type of ['FailureTarget', 'SuccessCriteriaMet']) {
      const finishing = { ...object, status: { ...object.status, conditions: [{ type, status: 'True' }] } };
      expect(jobOverview(record(finishing)).state?.word).toBe(type);
      expect(summary(finishing)).toEqual([]);
    }
  });

  it('says a Job that is deleted while it runs as Terminating, with no summary', () => {
    const { object } = found('states/running');
    const deleted = { ...object, metadata: { ...object.metadata, deletionTimestamp: '2026-11-21T08:30:00Z' } };
    expect(jobOverview(record(deleted)).state?.word).toBe('Terminating');
    expect(summary(deleted)).toEqual([]);
    expect(rows(deleted).map(([label]) => label)).not.toContain('Duration');
  });

  it('says a Job that wants no count as the list does: what it has done over one, and how many it runs at a time', () => {
    expect(rows(found('states/work-queue').object)[0]).toEqual(['Completions', '2/1 of 2']);
    expect(summary(found('states/work-queue').object)).toEqual(['took 5 s']);
    const { object } = found('states/running');
    const parallel = { ...object, spec: { parallelism: 2 } };
    expect(summary(parallel)).toEqual(['0/1 of 2 completions']);
  });

  it('says how long a Job took only when it states both its start and its completion', () => {
    const { object } = found('batch/nightly-report');
    expect(summary(object)).toEqual(['took 9 s']);
    const { completionTime: _, ...status } = object.status;
    expect(summary({ ...object, status })).toEqual([]);
    const { startTime: __, ...unstarted } = object.status;
    expect(summary({ ...object, status: unstarted })).toEqual([]);
  });
});

describe('a Job a CronJob made', () => {
  it('names the CronJob that controls it as an object of its namespace, between the backoff limit and the rest', () => {
    for (const [id, name] of [['more/done-29920824', 'done'], ['more/forbid-29920824', 'forbid']] as const) {
      const fact = jobOverview(record(found(id).object)).details.find((candidate) => candidate.label === 'Owner');
      expect(fact?.value, id).toEqual({ kind: 'ref', ref: { kind: 'CronJob', name, namespace: 'more' }, text: `CronJob ${name}` });
      expect(rows(found(id).object).map(([label]) => label).slice(0, 4), id).toEqual(['Completions', 'Parallelism', 'Backoff limit', 'Owner']);
    }
  });

  it('names no owner for an object that does not control it, or one that is not named', () => {
    const { object } = found('more/done-29920824');
    const owners = (ownerReferences: unknown) => rows({ ...object, metadata: { ...object.metadata, ownerReferences } }).map(([label]) => label);
    expect(owners([{ kind: 'CronJob', name: 'done', controller: false }])).not.toContain('Owner');
    expect(owners([{ kind: 'CronJob', controller: true }])).not.toContain('Owner');
    expect(owners([{ name: 'done', controller: true }])).not.toContain('Owner');
  });
});

describe('the time a Job started, and how long it has run', () => {
  const { object } = found('states/running');
  const created = Date.parse(object.metadata.creationTimestamp);
  const startedAfter = (milliseconds: number) => ({ ...object, status: { ...object.status, startTime: new Date(created + milliseconds).toISOString() } });

  it('says when it started only when that is a minute or more after it was made: a Job starts a moment after, and the age says so', () => {
    expect(rows(startedAfter(59_000)).map(([label]) => label)).not.toContain('Started');
    expect(jobOverview(record(startedAfter(60_000))).details.find((fact) => fact.label === 'Started')?.value).toEqual({ kind: 'moment', at: created + 60_000 });
    expect(rows(startedAfter(90_000)).map(([label]) => label)).toEqual(['Completions', 'Parallelism', 'Backoff limit', 'Started', 'Duration']);
  });

  it('says the time since the start while it runs, in epoch milliseconds, and not once it is over', () => {
    expect(jobOverview(record(startedAfter(90_000))).details.find((fact) => fact.label === 'Duration')?.value).toEqual({ kind: 'running', since: created + 90_000 });
    const { object: done } = found('batch/nightly-report');
    expect(rows(done).map(([label]) => label)).not.toContain('Duration');
  });

  it('says when a finished Job started, with the instant in milliseconds, when it started late', () => {
    const { object: done } = found('batch/nightly-report');
    const late = { ...done, status: { ...done.status, startTime: '2026-11-21T08:25:00Z', completionTime: '2026-11-21T08:26:00Z' } };
    expect(jobOverview(record(late)).details.find((fact) => fact.label === 'Started')?.value).toEqual({ kind: 'moment', at: at('2026-11-21T08:25:00Z') });
    expect(summary(late)).toEqual(['took 1 min']);
  });
});

describe('the time limit and the clean-up', () => {
  const { object } = found('detail/limited');
  const spec = (patch: Record<string, unknown>) => rows({ ...object, spec: { ...object.spec, ...patch } });

  it('says a time limit only when it is more than zero', () => {
    expect(spec({ activeDeadlineSeconds: 90 }).find(([label]) => label === 'Time limit')).toEqual(['Time limit', '1 min 30 s']);
    expect(spec({ activeDeadlineSeconds: 0 }).map(([label]) => label)).not.toContain('Time limit');
  });

  it('says a clean-up that is stated, a zero as well: the Job goes the moment it finishes', () => {
    expect(spec({ ttlSecondsAfterFinished: 0 }).find(([label]) => label === 'Cleaned up')).toEqual(['Cleaned up', '0 s after it finishes']);
    expect(spec({ ttlSecondsAfterFinished: 300 }).find(([label]) => label === 'Cleaned up')).toEqual(['Cleaned up', '5 min after it finishes']);
  });

  it('says a backoff limit of zero, which the API states, and no row for one it does not', () => {
    expect(spec({ backoffLimit: 0 }).find(([label]) => label === 'Backoff limit')).toEqual(['Backoff limit', '0']);
    const { backoffLimit: _, ...without } = object.spec;
    expect(rows({ ...object, spec: without }).map(([label]) => label)).not.toContain('Backoff limit');
  });
});

describe('the conditions, the labels and the annotations', () => {
  const { object } = found('states/suspended');
  const applied = 'kubectl.kubernetes.io/last-applied-configuration';

  it('has the Suspended condition, as the object states it', () => {
    expect(jobOverview(record(object)).conditions.map((row) => [row.type, row.status, row.reason])).toEqual([['Suspended', 'True', 'JobSuspended']]);
  });

  it('has no credential\'s value and no last applied configuration in the data', () => {
    const annotations = { 'example.io/api-token': 'sentinel-job-token', [applied]: 'sentinel-applied-configuration' };
    const overview = jobOverview(record({ ...object, metadata: { ...object.metadata, annotations } }));
    expect(overview.annotations.map((tag) => [tag.key, tag.protected])).toEqual([['example.io/api-token', true], [applied, true]]);
    expect(JSON.stringify(overview)).not.toContain('sentinel-job-token');
    expect(JSON.stringify(overview)).not.toContain('sentinel-applied-configuration');
  });
});

describe('the rows of each Job, against `kubectl describe`', () => {
  for (const { object, describe: described } of golden.objects) {
    const id = idOf(object);
    const fields = described === undefined ? new Map<string, string>() : describedFields(described);
    const row = (label: string) => rows(object).find(([name]) => name === label)?.[1];

    it(`${id}: Parallelism, Completions and the Backoff limit are describe's`, () => {
      expect(row('Parallelism')).toBe(fields.get('Parallelism'));
      expect(row('Backoff limit')).toBe(fields.get('Backoff Limit'));
      const completions = fields.get('Completions');
      const succeeded = object.status.succeeded ?? 0;
      // `<unset>` is a Job that wants no count: kubectl's COMPLETIONS says one, and how many run at a time.
      expect(row('Completions')).toBe(completions === '<unset>' ? `${succeeded}/1 of ${fields.get('Parallelism')}` : `${succeeded}/${completions}`);
    });

    it(`${id}: the Time limit is Active Deadline Seconds, and the Cleaned up row is TTL Seconds After Finished`, () => {
      const deadline = fields.get('Active Deadline Seconds');
      expect(row('Time limit')).toBe(deadline === undefined ? undefined : spanText(Number.parseInt(deadline, 10)));
      const ttl = fields.get('TTL Seconds After Finished');
      expect(row('Cleaned up')).toBe(ttl === undefined ? undefined : `${spanText(Number(ttl))} after it finishes`);
    });

    it(`${id}: the took note of a finished Job is describe's Duration, and a Job that has not finished has none`, () => {
      const word = jobOverview(record(object)).state?.word;
      const duration = fields.get('Duration');
      const [note] = summary(object);
      if (word === 'Complete') {
        expect(duration, id).toBeDefined();
        expect(note).toBe(`took ${spanText(kubectlSeconds(duration ?? ''))}`);
      } else {
        expect(duration, id).toBeUndefined();
      }
    });

    it(`${id}: the Owner row is describe's Controlled By, as a link to the object it names`, () => {
      const controlled = fields.get('Controlled By');
      const fact = jobOverview(record(object)).details.find((candidate) => candidate.label === 'Owner');
      if (controlled === undefined) {
        expect(fact).toBeUndefined();
        return;
      }

      const [kind, name] = controlled.split('/');
      expect(fact?.value).toEqual({ kind: 'ref', ref: { kind, name, namespace: object.metadata.namespace }, text: `${kind} ${name}` });
    });

    it(`${id}: the labels are the object's, and the annotations are the object's with every credential and the last applied configuration masked`, () => {
      const overview = jobOverview(record(object));
      expect(Object.fromEntries(overview.labels.map((tag) => [tag.key, tag.value]))).toEqual(object.metadata.labels ?? {});
      expect(overview.annotations).toEqual(annotationModels(object.metadata.annotations ?? {}));
      for (const tag of overview.annotations) {
        if (tag.protected) {
          expect(tag.value, tag.key).toBeUndefined();
        }
      }
    });

    it(`${id}: the header says the word the list says, and no row is empty`, () => {
      const overview = jobOverview(record(object));
      expect(overview.state).toEqual(jobRow(record(object)).status);
      expect(overview.createdAt).toBe(jobRow(record(object)).createdAt);
      for (const [label, text] of rowsOf(overview)) {
        expect(text, label).not.toBe('');
      }
    });
  }
});

describe('an object that says little, or is not a Job at all', () => {
  it('says nothing of a state, a count or a time it does not hold, and no word is made up', () => {
    const overview = jobOverview(record({ metadata: { name: 'x', namespace: 'n' } }));
    expect(overview.state).toBeUndefined();
    expect(overview.summary).toEqual([]);
    expect(overview.details).toEqual([]);
    expect(overview.conditions).toEqual([]);
  });

  it('still names the owner of a Job that has no spec and no status', () => {
    expect(rows({ metadata: { name: 'x', namespace: 'n', ownerReferences: [{ kind: 'CronJob', name: 'c', controller: true }] } })).toEqual([['Owner', 'CronJob c']]);
  });

  it('keeps each field only when it has the type the API gives it', () => {
    const overview = jobOverview(record({
      metadata: { name: 'x', namespace: 'n', labels: 'bad', ownerReferences: 'bad' },
      spec: { completions: 'one', parallelism: '1', backoffLimit: 'six', activeDeadlineSeconds: '5', ttlSecondsAfterFinished: '5' },
      status: { startTime: 7, completionTime: [], succeeded: 'one', conditions: 'bad' },
    }));
    // With a spec and a status, the counts the object does not state as numbers are the API's zero and one, as the list says them.
    expect(rowsOf(overview)).toEqual([['Completions', '0/1']]);
    expect(summaryText(overview.summary)).toEqual(['0/1 completions']);
    expect(overview.labels).toEqual([]);
    expect(overview.conditions).toEqual([]);
  });

  it('reads an object of another shape as an empty Job, never an error', () => {
    expect(() => jobOverview(record('not an object'))).not.toThrow();
    expect(jobOverview(record(null)).details).toEqual([]);
  });
});

describe('what the definition says of its page', () => {
  it('has a page of its own, named for the Kind, whose route names the object by its namespace and its name', () => {
    expect(jobDefinition.detail?.page).toBe('job');
    expect(jobDefinition.detail?.identity).toEqual(['namespace', 'name']);
    expect(jobDefinition.detail?.overview).toBe(jobOverview);
  });

  it('lays out the commands the mock lays out for a Job, every one of them offered unavailable', () => {
    expect(jobDefinition.detail?.commands).toBe(jobCommands);
    expect(jobCommands(record(found('states/running').object))).toEqual({
      primary: { id: 'logs', label: 'Logs' },
      danger: { id: 'delete', label: 'Delete' },
      menu: [{ id: 'forward-port', label: 'Forward port…' }, { id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }, { id: 'suspend', label: 'Suspend…' }],
    });
  });
});
