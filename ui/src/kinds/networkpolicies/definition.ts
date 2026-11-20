import { column, typeOf, type KindDefinition } from '../definition';
import { ageCell, textCell } from '../display';

import { networkPolicyRow, networkPolicyRows, networkPolicySearchText, type NetworkPolicyRow } from './row';

// The NetworkPolicy definition, as the mock's `PRINTER.NetworkPolicy` has it (MOCK k8s-resource-definitions.js:797; ch17 K60.3): after the name, the Pod selector and Age. The Columns chooser's set
// (Namespace, Policy types, Ingress rules, Egress rules) waits for the list page to have it. A NetworkPolicy has no state of its own, so it shows none, and the mock has no quick filters for it.

const identity = { group: 'networking.k8s.io', version: 'v1', resource: 'networkpolicies' } as const;

export const networkPolicyDefinition: KindDefinition<NetworkPolicyRow> = {
  identity,
  type: typeOf(identity),
  kind: 'NetworkPolicy',
  nouns: { one: 'NetworkPolicy', other: 'NetworkPolicies' },
  page: 'networkpolicies',
  tile: { icon: 'brick-wall', tone: 'blue' },
  model: { row: networkPolicyRow, rows: networkPolicyRows, searchText: networkPolicySearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('podSelector', 'Pod selector', 'flex', 72, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    // Every requirement, joined by a comma and a space; the column cuts what does not fit.
    { id: 'podSelector', sortValue: (row) => row.podSelector, display: ({ podSelector }) => textCell(podSelector, 'The policy states no pod selector.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The policy has no creation time.') },
  ],
};
