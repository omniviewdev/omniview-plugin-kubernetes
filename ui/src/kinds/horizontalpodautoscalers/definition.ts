import { GENERIC_TILE, column, typeOf, type KindDefinition } from '../definition';
import { ageCell, countCell, namesCell, statusCell, textCell } from '../display';

import { horizontalPodAutoscalerRow, horizontalPodAutoscalerRows, horizontalPodAutoscalerSearchText, type HorizontalPodAutoscalerRow } from './row';

// The HorizontalPodAutoscaler definition, as the mock's `PRINTER.HorizontalPodAutoscaler` has it (MOCK k8s-resource-definitions.js:808-811; ch17 K60.3): after the name, Status, Reference (the mock's `targetRef`),
// Targets, Replicas and Age. The wide set (Min pods, Max pods) and the Columns chooser's wait for the list page to have them. The mock gives the kind a state word and no quick filters, so there is no strip.
// The objects are autoscaling/v2, which the plugin's catalog reads as the preferred version.

const identity = { group: 'autoscaling', version: 'v2', resource: 'horizontalpodautoscalers' } as const;

export const horizontalPodAutoscalerDefinition: KindDefinition<HorizontalPodAutoscalerRow> = {
  identity,
  type: typeOf(identity),
  kind: 'HorizontalPodAutoscaler',
  nouns: { one: 'HorizontalPodAutoscaler', other: 'HorizontalPodAutoscalers' },
  page: 'horizontalpodautoscalers',
  // The mock's glyph is a scaling arrow (Lucide `Scaling`), which the kit's registry does not have yet: the generic tile stands for it.
  tile: GENERIC_TILE,
  model: { row: horizontalPodAutoscalerRow, rows: horizontalPodAutoscalerRows, searchText: horizontalPodAutoscalerSearchText },
  columns: [
    column('name', 'Name', 'id', 160, 'left', 'text', { required: true }),
    // 150 px holds the longest state word of an autoscaler, `Unable to scale`, with its glyph (the mock's worksheet: 7.2 px a character plus 42).
    column('status', 'Status', 'fixed', 150, 'left', 'text'),
    column('reference', 'Reference', 'flex', 72, 'left', 'text'),
    column('targets', 'Targets', 'flex', 72, 'left', 'text'),
    column('replicas', 'Replicas', 'fixed', 72, 'right', 'number'),
    column('age', 'Age', 'fixed', 59, 'left', 'time'),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: () => 0 },
    quickFilters: [],
  },
  fields: [
    { id: 'name', sortValue: (row) => row.name, display: (row) => ({ kind: 'text', text: row.name }) },
    { id: 'status', sortValue: (row) => row.status?.word, display: ({ status }) => statusCell(status, 'The autoscaler has not reported yet.') },
    { id: 'reference', sortValue: (row) => row.reference, display: ({ reference }) => textCell(reference, 'The autoscaler names no target.') },
    // Every metric, joined by a comma and a space; the column cuts what does not fit.
    { id: 'targets', sortValue: (row) => row.targets?.join(', '), display: ({ targets }) => namesCell(targets, Infinity, 'The autoscaler names no metric.') },
    { id: 'replicas', sortValue: (row) => row.replicas, display: ({ replicas }) => countCell(replicas, 'The autoscaler reports no current replicas.') },
    { id: 'age', sortValue: (row) => row.createdAt, display: ({ createdAt }, now) => ageCell(createdAt, now, 'The HorizontalPodAutoscaler has no creation time.') },
  ],
};
