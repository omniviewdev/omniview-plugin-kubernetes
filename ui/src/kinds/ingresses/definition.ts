import { GENERIC_TILE, column, typeOf, type KindDefinition } from '../definition';
import { ageCell, namesCell, textCell } from '../display';

import { ingressRow, ingressRows, ingressSearchText, type IngressRow } from './row';

// The Ingress definition, as the mock's `PRINTER.Ingress` has it (MOCK k8s-resource-definitions.js:783-792; ch17 K60.3): after the name, Class, Hosts, Address, Ports and Age. The wide set (TLS hosts) and the
// Columns chooser's (TLS Secrets) wait for the list page to have them, and so does the Class facet. An Ingress has no state word in the mock (an address it has not got yet is not a state it states), so it
// shows none, and the mock has no quick filters for it.

const identity = { group: 'networking.k8s.io', version: 'v1', resource: 'ingresses' } as const;

export const ingressDefinition: KindDefinition<IngressRow> = {
  identity,
  type: typeOf(identity),
  kind: 'Ingress',
  nouns: { one: 'Ingress', other: 'Ingresses' },
  page: 'ingresses',
  // The mock's glyph is a globe (Lucide `Globe`), which the kit's registry does not have yet: the generic tile stands for it.
  tile: GENERIC_TILE,
  model: { row: ingressRow, rows: ingressRows, searchText: ingressSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('class', 'Class', 'flex', 72, 'left', 'text'),
    column('hosts', 'Hosts', 'flex', 72, 'left', 'text'),
    column('address', 'Address', 'flex', 72, 'left', 'text'),
    column('ports', 'Ports', 'flex', 72, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'class', sortValue: (row) => row.className, display: ({ className }) => textCell(className, 'The Ingress names no class.') },
    // Every host, joined by a comma and a space; the column cuts what does not fit.
    { id: 'hosts', sortValue: (row) => row.hosts?.join(', '), display: ({ hosts }) => namesCell(hosts, Infinity, 'The Ingress has no rules.') },
    // The first two addresses and the number of the rest, in the code face, as the mock's `addresses` cell; the whole list is the tip.
    { id: 'address', sortValue: (row) => row.address?.join(', '), display: ({ address }) => namesCell(address, 2, 'No controller has given the Ingress an address.', true) },
    { id: 'ports', sortValue: (row) => row.ports, display: ({ ports }) => textCell(ports, 'The Ingress states no spec.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The Ingress has no creation time.') },
  ],
};
