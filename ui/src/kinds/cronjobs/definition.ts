import { column, typeOf, type KindDefinition } from '../definition';
import { ageCell, countCell, statusCell, textCell } from '../display';

import { cronJobRow, cronJobRows, cronJobSearchText, type CronJobRow } from './row';

// The CronJob definition, as the mock's `PRINTER.CronJob` has it (MOCK k8s-resource-definitions.js:762-766; ch17 K60.3): after the name, Schedule, Status, Active, Last schedule and Age. The wide set
// (Suspend, Time zone) and the Columns chooser's (Containers, Images, Concurrency policy, ...) wait for the list page to have them. The state is the mock's: Active, or Suspended when `spec.suspend`
// says so; kubectl prints the boolean. A CronJob's name is not generated (its Jobs' are).

const identity = { group: 'batch', version: 'v1', resource: 'cronjobs' } as const;

const NO_SCHEDULE = 'The CronJob states no schedule.';

export const cronJobDefinition: KindDefinition<CronJobRow> = {
  identity,
  type: typeOf(identity),
  kind: 'CronJob',
  nouns: { one: 'CronJob', other: 'CronJobs' },
  page: 'cronjobs',
  tile: { icon: 'calendar-clock', tone: 'blue' },
  model: { row: cronJobRow, rows: cronJobRows, searchText: cronJobSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('schedule', 'Schedule', 'flex', 72, 'left', 'text'),
    // 107 px holds the longest state word of a CronJob, `Suspended`, with its glyph (the mock's worksheet: 7.2 px a character plus 42).
    column('status', 'Status', 'fixed', 107, 'left', 'text'),
    column('active', 'Active', 'fixed', 59, 'right', 'number'),
    column('lastSchedule', 'Last schedule', 'fixed', 120, 'left', 'time'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    // The kind's own split of its state words (MOCK `bar`): the two words of a CronJob, each a filter.
    quickFilters: [
      { id: 'active', label: 'Active', tone: 'success', test: (row) => row.status?.word === 'Active' },
      { id: 'suspended', label: 'Suspended', tone: 'muted', test: (row) => row.status?.word === 'Suspended' },
    ],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'schedule', sortValue: (row) => row.schedule, display: ({ schedule }) => textCell(schedule, NO_SCHEDULE) },
    { id: 'status', sortValue: (row) => row.status?.word, display: ({ status }) => statusCell(status, NO_SCHEDULE) },
    { id: 'active', sortValue: (row) => row.active, display: ({ active }) => countCell(active, 'The CronJob reports no status yet.') },
    { id: 'lastSchedule', sortValue: (row) => row.lastScheduleAt, display: ({ lastScheduleAt }, now) => ageCell(lastScheduleAt, now, 'The CronJob has not run yet.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The CronJob has no creation time.') },
  ],
};
