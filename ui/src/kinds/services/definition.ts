import { servicePlacement } from '../../extensions/details';
import { column, typeOf, type KindDefinition } from '../definition';
import { ageCell, namesCell, textCell } from '../display';

import { serviceCommands, serviceOverview } from './detail';
import { serviceRow, serviceRows, serviceSearchText, type ServiceRow } from './row';

// The Service definition, as the mock's `PRINTER.Service` has it (MOCK k8s-resource-definitions.js:775-780; ch17 K60.3): after the name, Type, Cluster IP, Ports and Age. The wide set (External IP) and the
// Columns chooser's (Selector, Session affinity, ...) wait for the list page to have them, and so does the Type facet. A Service has no lifecycle state, so it shows none (no invented status), and the mock
// has no quick filters for it.

const identity = { group: '', version: 'v1', resource: 'services' } as const;

export const serviceDefinition: KindDefinition<ServiceRow> = {
  identity,
  type: typeOf(identity),
  kind: 'Service',
  nouns: { one: 'Service', other: 'Services' },
  page: 'services',
  tile: { icon: 'waypoints', tone: 'blue' },
  model: { row: serviceRow, rows: serviceRows, searchText: serviceSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    // The mock declares 110 px for the type (`LoadBalancer` and `ExternalName` are its longest words) and 113 px for an address.
    column('type', 'Type', 'fixed', 110, 'left', 'text'),
    column('clusterIP', 'Cluster IP', 'fixed', 113, 'left', 'text'),
    column('ports', 'Ports', 'flex', 72, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    {
      id: 'name',
      sortValue: (row) => row.name,
      display: (row) => ({ kind: 'text', text: row.name }),
    },
    {
      id: 'type',
      sortValue: (row) => row.type,
      display: ({ type }) => textCell(type, 'The Service states no type.'),
    },
    {
      id: 'clusterIP',
      sortValue: (row) => row.clusterIP,
      display: ({ clusterIP }) => textCell(clusterIP, 'The Service has no cluster address.', true),
    },
    // Every port, joined by a comma and a space (the mock's `Cell.mono(value.join(', '))`); the column cuts what does not fit.
    {
      id: 'ports',
      sortValue: (row) => row.ports?.join(', '),
      display: ({ ports }) => namesCell(ports, Infinity, 'The Service has no ports.', true),
    },
    {
      id: 'age',
      sortValue: (row) => row.createdAt,
      display: ({ createdAt }, now) => ageCell(createdAt, now, 'The Service has no creation time.'),
    },
  ],
  // The page of one Service (`./detail.ts`), drawn by the generic detail page.
  detail: {
    page: 'service',
    identity: ['namespace', 'name'],
    overview: serviceOverview,
    commands: serviceCommands,
    placeExtensions: servicePlacement,
  },
};
