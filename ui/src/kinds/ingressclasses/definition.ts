import { GENERIC_TILE, column, typeOf, type KindDefinition } from '../definition';
import { ageCell, textCell } from '../display';

import { ingressClassRow, ingressClassRows, ingressClassSearchText, type IngressClassRow } from './row';

// The IngressClass definition, as the mock's `PRINTER.IngressClass` has it (MOCK k8s-resource-definitions.js:796; ch17 K60.3): after the name, Controller, Parameters and Age. The Columns chooser's Default (the
// annotation `ingressclass.kubernetes.io/is-default-class`) waits for the list page to have it, so it is not a column here. An IngressClass lives in no namespace: its read has no namespace in it, and its
// row has no second line under the name. It has no state word, so it shows none, and the mock has no quick filters for it.

const identity = { group: 'networking.k8s.io', version: 'v1', resource: 'ingressclasses' } as const;

export const ingressClassDefinition: KindDefinition<IngressClassRow> = {
  identity,
  type: typeOf(identity),
  kind: 'IngressClass',
  nouns: { one: 'IngressClass', other: 'IngressClasses' },
  page: 'ingressclasses',
  // The mock's glyph is a list as a tree (Lucide `list-tree`), which the kit's registry does not have yet: the generic tile stands for it.
  tile: GENERIC_TILE,
  model: { row: ingressClassRow, rows: ingressClassRows, searchText: ingressClassSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    column('controller', 'Controller', 'flex', 72, 'left', 'text'),
    column('parameters', 'Parameters', 'flex', 72, 'left', 'text'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: () => null, tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'controller', sortValue: (row) => row.controller, display: ({ controller }) => textCell(controller, 'The class names no controller.') },
    { id: 'parameters', sortValue: (row) => row.parameters, display: ({ parameters }) => textCell(parameters, 'The class has no parameters.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The class has no creation time.') },
  ],
};
