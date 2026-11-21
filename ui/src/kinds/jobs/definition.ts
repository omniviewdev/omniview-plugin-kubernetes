import { column, typeOf, type Cell, type KindDefinition } from '../definition';
import { ageCell, mono, none, statusCell } from '../display';
import { spanText } from '../fields';

import { jobCommands, jobOverview } from './detail';
import { completionsText, jobRow, jobRows, jobSearchText, type JobRow } from './row';

// The Job definition, as the mock's `PRINTER.Job` has it (MOCK k8s-resource-definitions.js:769-774; ch17 K60.3): after the name, Status, Completions, Duration and Age. The wide set (Images, Owner),
// the Owner facet and the Columns chooser's wait for the list page to have them. A Job's name can be generated (a CronJob's schedule time), so the end of it stays whole when it is cut.

const identity = { group: 'batch', version: 'v1', resource: 'jobs' } as const;

/**
 * The span a Job ran: from its start to its completion, to the second; a Job that has not finished (still running, or Failed, which has no completion time) is read from its start to now and the page's
 * clock keeps it current. kubectl and the mock read it the same way; a Job that never started has none.
 */
function durationCell({ startedAt, finishedAt }: JobRow, now: number): Cell {
  if (startedAt === undefined) {
    return none('The Job has not started.');
  }

  return finishedAt === undefined
    ? { kind: 'elapsed', since: startedAt, text: spanText(Math.floor((now - startedAt) / 1000)) }
    : { kind: 'text', text: spanText((finishedAt - startedAt) / 1000) };
}

export const jobDefinition: KindDefinition<JobRow> = {
  identity,
  type: typeOf(identity),
  kind: 'Job',
  nouns: { one: 'Job', other: 'Jobs' },
  page: 'jobs',
  tile: { icon: 'clipboard-check', tone: 'blue' },
  model: { row: jobRow, rows: jobRows, searchText: jobSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    // 107 px holds the longest word of a Job, `Suspended`, with its glyph (the mock's worksheet: 7.2 px a character plus 42).
    column('status', 'Status', 'fixed', 107, 'left', 'text'),
    column('completions', 'Completions', 'fixed', 98, 'right', 'ratio'),
    column('duration', 'Duration', 'fixed', 94, 'right', 'number'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: (row) => row.nameTail },
    // The kind's own split of its state words (MOCK `bar`): the four words of a Job, each a filter.
    quickFilters: [
      { id: 'running', label: 'Running', tone: 'info', test: (row) => row.status?.word === 'Running' },
      { id: 'complete', label: 'Complete', tone: 'success', test: (row) => row.status?.word === 'Complete' },
      { id: 'failed', label: 'Failed', tone: 'error', test: (row) => row.status?.word === 'Failed' },
      { id: 'suspended', label: 'Suspended', tone: 'muted', test: (row) => row.status?.word === 'Suspended' },
    ],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'status', sortValue: (row) => row.status?.word, display: ({ status }) => statusCell(status, 'The Job reports no state.') },
    {
      id: 'completions',
      sortValue: (row) => row.completions,
      display: ({ completions }) => (completions === undefined ? none('The Job states no completions.') : mono(completionsText(completions))),
    },
    {
      id: 'duration',
      // A Job that has not finished is read against now: this runs when the user sorts, never in render.
      sortValue: ({ startedAt, finishedAt }) => (startedAt === undefined ? undefined : Math.floor(((finishedAt ?? Date.now()) - startedAt) / 1000)),
      display: durationCell,
    },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The Job has no creation time.') },
  ],
  // The page of one Job (`./detail.ts`), drawn by the generic detail page.
  detail: { page: 'job', identity: ['namespace', 'name'], overview: jobOverview, commands: jobCommands },
};
