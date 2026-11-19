import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import type { KindRow, RowModel } from './definition';
import { createdAt, nameTail } from './fields';
import type { ObjectMeta } from './object';

/**
 * The identity every row holds, from the record and the metadata of the object it carries. `generated` says that the kind's names end in the part that tells siblings apart (a Pod's hash,
 * a Job's schedule time: MOCK GENERATED_KINDS), so a cell keeps that end whole when it cuts the name.
 */
export function identityOf(host: HostRecord, object: { readonly metadata?: ObjectMeta }, generated: boolean): KindRow {
  const name = object.metadata?.name ?? '';
  return { key: host.key, name, namespace: object.metadata?.namespace ?? '', nameTail: generated ? nameTail(name) : 0, createdAt: createdAt(object) };
}

/**
 * A kind's row model. Rows are derived once per record OBJECT, never in render: the source view keeps every unchanged record as the same object, so a live update derives only the records
 * that changed (18 µs a Pod, plan 2.2), and an unchanged array of records gives the same array of rows. `searchParts` are what a person can read in a row; the text of a row is built once.
 */
export function rowModel<TRow extends KindRow>(decode: (host: HostRecord) => TRow, searchParts: (row: TRow) => ReadonlyArray<string | undefined>): RowModel<TRow> {
  const rowOf = new WeakMap<HostRecord, TRow>();
  const rowsOf = new WeakMap<readonly HostRecord[], readonly TRow[]>();
  const searchOf = new WeakMap<TRow, string>();

  const row = (host: HostRecord): TRow => {
    let found = rowOf.get(host);
    if (found === undefined) {
      found = decode(host);
      rowOf.set(host, found);
    }

    return found;
  };

  return {
    row,
    rows: (records) => {
      let found = rowsOf.get(records);
      if (found === undefined) {
        found = records.map(row);
        rowsOf.set(records, found);
      }

      return found;
    },
    searchText: (target) => {
      let found = searchOf.get(target);
      if (found === undefined) {
        found = searchParts(target).filter((part): part is string => part !== undefined && part !== '').join('\n').toLowerCase();
        searchOf.set(target, found);
      }

      return found;
    },
  };
}
