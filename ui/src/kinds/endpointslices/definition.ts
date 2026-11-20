import { GENERIC_TILE, column, typeOf, type KindDefinition } from '../definition';
import { ageCell, namesCell, textCell } from '../display';

import { endpointSliceRow, endpointSliceRows, endpointSliceSearchText, type EndpointSliceRow } from './row';

// The EndpointSlice definition, as the mock's `PRINTER.EndpointSlice` has it (MOCK k8s-resource-definitions.js:784-787; ch17 K60.3): after the name, Address type, Ports, Endpoints and Age. The wide set
// (Service) and the Columns chooser's (Namespace, Ready, Endpoint count) wait for the list page to have them. An EndpointSlice has no state word (the mock's list does not read readiness), so it shows
// none, and the mock has no quick filters for it. Its name is generated, so the list keeps the end whole when it cuts it (the mock's GENERATED_KINDS).

const identity = { group: 'discovery.k8s.io', version: 'v1', resource: 'endpointslices' } as const;

export const endpointSliceDefinition: KindDefinition<EndpointSliceRow> = {
  identity,
  type: typeOf(identity),
  kind: 'EndpointSlice',
  nouns: { one: 'EndpointSlice', other: 'EndpointSlices' },
  page: 'endpointslices',
  // The mock's glyph is a path that splits in two (Lucide `split`), which the kit's registry does not have yet: the generic tile stands for it.
  tile: GENERIC_TILE,
  model: { row: endpointSliceRow, rows: endpointSliceRows, searchText: endpointSliceSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('addressType', 'Address type', 'flex', 72, 'left', 'text'),
    column('ports', 'Ports', 'flex', 72, 'left', 'text'),
    column('endpoints', 'Endpoints', 'flex', 72, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: (row) => row.nameTail },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'addressType', sortValue: (row) => row.addressType, display: ({ addressType }) => textCell(addressType, 'The slice states no address type.') },
    // Every port, joined by a comma and a space, in the code face (the mock's `Cell.mono(value.join(', '))`); the column cuts what does not fit.
    { id: 'ports', sortValue: (row) => row.ports?.join(', '), display: ({ ports }) => namesCell(ports, Infinity, 'The slice has no ports.', true) },
    // The first two addresses and the number of the rest, in the code face, as the mock's `addresses` cell; the whole list is the tip.
    { id: 'endpoints', sortValue: (row) => row.endpoints?.join(', '), display: ({ endpoints }) => namesCell(endpoints, 2, 'The slice has no endpoints.', true) },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The slice has no creation time.') },
  ],
};
