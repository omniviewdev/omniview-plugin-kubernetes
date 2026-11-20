import { GENERIC_TILE, column, typeOf, type KindDefinition } from '../definition';
import { ageCell, namesCell } from '../display';

import { resourceQuotaRow, resourceQuotaRows, resourceQuotaSearchText, type ResourceQuotaRow } from './row';

// The ResourceQuota definition, as the mock's `PRINTER.ResourceQuota` has it (MOCK k8s-resource-definitions.js:803-806; ch17 K60.3): after the name, Age, Request and Limit, in the order of the mock's `show`
// (kubectl prints Age last). A Request says `<resource> <used> of <hard>` for each hard limit on `requests.`, and a Limit says the same over `limits.`. The Columns chooser's (Scopes, Pods used, Pod limit)
// wait for the list page to have it, and the mock has no quick filters for the kind.

const identity = { group: '', version: 'v1', resource: 'resourcequotas' } as const;

export const resourceQuotaDefinition: KindDefinition<ResourceQuotaRow> = {
  identity,
  type: typeOf(identity),
  kind: 'ResourceQuota',
  nouns: { one: 'ResourceQuota', other: 'ResourceQuotas' },
  page: 'resourcequotas',
  // The mock's glyph is a gauge (Lucide `Gauge`), which the kit's registry does not have yet: the generic tile stands for it.
  tile: GENERIC_TILE,
  model: { row: resourceQuotaRow, rows: resourceQuotaRows, searchText: resourceQuotaSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
    column('request', 'Request', 'flex', 72, 'left', 'text'),
    column('limit', 'Limit', 'flex', 72, 'left', 'text'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The ResourceQuota has no creation time.') },
    // Every piece, joined by a comma and a space; the column cuts what does not fit.
    { id: 'request', sortValue: (row) => row.request?.join(', '), display: ({ request }) => namesCell(request, Infinity, 'The quota sets no requests.') },
    { id: 'limit', sortValue: (row) => row.limit?.join(', '), display: ({ limit }) => namesCell(limit, Infinity, 'The quota sets no limits.') },
  ],
};
