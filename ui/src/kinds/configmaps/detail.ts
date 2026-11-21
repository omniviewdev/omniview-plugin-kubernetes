import type { StatusSummaryItem } from '@omniviewdev/kit';

import type { KindCommands } from '../definition';
import { annotationModels, labelModels } from '../detail/metadata';
import { detailMeta } from '../detail/object';
import { facts, overviewModel, textFact, type KindOverview } from '../detail/overview';
import { counted } from '../detail/text';
import { bytesText } from '../fields';
import { bodyOf, flag, isObject, type Json } from '../object';

import { configMapRow, type ConfigMapRow } from './row';

// The page of one ConfigMap: what it says of the object a record holds, from the mock's `OVERVIEW.ConfigMap` (MOCK k8s-resource-definitions.js; K59). A ConfigMap has no state, so the header says none. The
// values of `data` and `binaryData` are NOT read here: the summary says how many keys there are and how many bytes they come to, both as the list derives them (`configMapRow`), and the page shows no value.

const NOTHING: Json = {};

/** `3 keys` and `1 KiB`, from the list's own count and size. An object that is not one says neither: no zero is made up for it. */
function summaryOf({ names, size }: ConfigMapRow): readonly StatusSummaryItem[] {
  return names === undefined || size === undefined ? [] : [{ text: counted(names.length, 'key') }, { text: bytesText(size) }];
}

export const configMapOverview = overviewModel((host): KindOverview => {
  const row = configMapRow(host);
  const body = bodyOf(host);
  const { metadata, immutable } = isObject(body) ? body : NOTHING;
  const { labels, annotations } = detailMeta(metadata);
  return {
    state: undefined,
    createdAt: row.createdAt,
    summary: summaryOf(row),
    // Only an object that says `immutable: true` has the row: false, or no word at all, is a ConfigMap that can change.
    details: facts(textFact('immutable', 'Immutable', flag(immutable) === true ? 'Yes' : undefined)),
    conditions: [],
    labels: labelModels(labels),
    annotations: annotationModels(annotations),
  };
});

/** The commands of a ConfigMap's header, as the mock lays them out for the kind (MOCK k8s-resource.js `LAYOUT.ConfigMap`; K59): Delete and the menu. Every one of them is offered unavailable (`../detail/commands.ts`). */
export function configMapCommands(): KindCommands {
  return {
    danger: { id: 'delete', label: 'Delete' },
    menu: [{ id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
  };
}
