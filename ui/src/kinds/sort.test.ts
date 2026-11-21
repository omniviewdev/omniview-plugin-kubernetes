import { describe, expect, it } from 'vitest';

import { listDefinition } from './list';
import mock from './mock-sorts.json';

import { KINDS } from './index';

// The 29 kinds sort as the design mock says (K3a). `mock-sorts.json` is what the mock's own definitions say (`hack/mock-sorts/capture.mjs`: `K8s.resourceDefinitions.list()` of k8s-resource-definitions.js, with
// no connection): for each kind its columns, each column's `sort` (`columns[i].sort = field.sort || SORT[field.format] || 'text'`, :1069, with `SORT` at :973) and the list's `defaultSort` (`:1084`: Name ascending
// unless the kind's printer says another, which only the Events kinds do). The definitions here are data in that shape; these tests hold each of them to the mock's, kind by kind.
//
// A column is the mock's by its LABEL (the words of the header, K60.1: "named as kubectl names them"): the plugin's ids are its own. The mock's `quantity` comparison (`compareQuantity`) is a number here: the
// definitions that carry a quantity say it as a number of bytes or cores, which orders as the quantity does.

type MockColumn = { readonly id: string; readonly label: string; readonly sort: string; readonly format: string; readonly defaultHidden: boolean };
type MockKind = { readonly type: string; readonly kind: string; readonly defaultSort: { readonly id: string; readonly direction: 'asc' | 'desc' }; readonly columns: readonly MockColumn[] };

const mocked = (type: string): MockKind | undefined => (mock.definitions as readonly MockKind[]).find((definition) => definition.type === type);

/** The kit's kind of a mock comparison: text is text; everything that is a number, an instant, a ratio or a quantity is a number. */
const kitKindOf = (comparison: string): 'text' | 'number' => (comparison === 'text' ? 'text' : 'number');

/**
 * Where a column deliberately sorts as what its cell SAYS and not as the mock's column of that name: the key is what the person reads. Each one is a column whose cell the plugin draws as another thing than
 * the mock's column of the same name (the mock's `Endpoints` of an EndpointSlice is a count, this plugin's is the addresses kubectl prints, as K2b-1's golden holds), and a sort that ordered by what the cell
 * does not say would be wrong whatever the mock does.
 */
const SAYS_ITS_OWN: Readonly<Record<string, readonly string[]>> = {
  EndpointSlice: ['Endpoints'],
};

describe('every kind sorts as the mock says', () => {
  it('lists the 29 kinds the plugin has, and the mock has each of them', () => {
    expect(KINDS).toHaveLength(29);
    expect(KINDS.filter((kind) => mocked(kind.type) === undefined).map((kind) => kind.type)).toEqual([]);
  });

  describe.each(KINDS.map((kind) => [kind.kind, kind] as const))('%s', (_name, kind) => {
    const reference = mocked(kind.type);
    const list = listDefinition(kind);

    it('opens on the mock\'s default sort, a column that sorts', () => {
      expect(list.defaultSort).toEqual({ column: reference?.defaultSort.id, direction: reference?.defaultSort.direction === 'desc' ? 'descending' : 'ascending' });
      expect(list.columns.find((column) => column.id === list.defaultSort?.column)?.sortKey).toBeDefined();
    });

    it('gives every column the mock sorts a sort key, compared as the mock compares it', () => {
      const problems: string[] = [];
      for (const column of list.columns) {
        const spec = kind.columns.find((candidate) => candidate.id === column.id);
        const sibling = reference?.columns.find((candidate) => candidate.label.toLowerCase() === column.header.toLowerCase());
        if (sibling === undefined) {
          problems.push(`${column.header}: the mock has no column of that name`);
          continue;
        }

        // The mock sorts every column but a sensitive one: a column of the list the mock sorts has a key.
        if (sibling.format !== 'sensitive' && column.sortKey === undefined) {
          problems.push(`${column.header}: the mock sorts it and it has no sort key`);
        }

        if (!(SAYS_ITS_OWN[kind.kind] ?? []).includes(column.header) && kitKindOf(sibling.sort) !== column.sortKind) {
          problems.push(`${column.header}: the mock compares it as ${sibling.sort} (the kit's ${kitKindOf(sibling.sort)}), the key is the kit's ${String(column.sortKind)}`);
        }

        if (!(SAYS_ITS_OWN[kind.kind] ?? []).includes(column.header) && spec?.sort !== sibling.sort && !(spec?.sort === 'number' && sibling.sort === 'quantity')) {
          problems.push(`${column.header}: the definition says ${String(spec?.sort)}, the mock ${sibling.sort}`);
        }
      }

      expect(problems).toEqual([]);
    });
  });
});
