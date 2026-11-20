import { column, typeOf, type KindDefinition } from '../definition';
import { ageCell, namesCell } from '../display';

import { endpointsRow, endpointsRows, endpointsSearchText, type EndpointsRow } from './row';

// The Endpoints definition, as the mock's `PRINTER.Endpoints` has it (MOCK k8s-resource-definitions.js:780-783; ch17 K60.3): after the name, Endpoints and Age. The wide set (Ready, Not ready) and the Columns
// chooser's (Namespace, Ports) wait for the list page to have them. An Endpoints object has no state word, so it shows none, and the mock has no quick filters for it.

const identity = { group: '', version: 'v1', resource: 'endpoints' } as const;

export const endpointsDefinition: KindDefinition<EndpointsRow> = {
  identity,
  type: typeOf(identity),
  kind: 'Endpoints',
  // Endpoints is its own plural: the mock's `kindLabel` keeps it (ch17 K60.4).
  nouns: { one: 'Endpoints', other: 'Endpoints' },
  page: 'endpoints',
  tile: { icon: 'target', tone: 'blue' },
  model: { row: endpointsRow, rows: endpointsRows, searchText: endpointsSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('endpoints', 'Endpoints', 'flex', 72, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    // The first two entries and the number of the rest, in the code face, as the mock's `addresses` cell; the whole list is the tip.
    { id: 'endpoints', sortValue: (row) => row.endpoints?.join(', '), display: ({ endpoints }) => namesCell(endpoints, 2, 'The Endpoints name no ready address.', true) },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The Endpoints have no creation time.') },
  ],
};
