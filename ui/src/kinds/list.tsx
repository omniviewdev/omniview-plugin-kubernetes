import type { DataTableColumn } from '@omniviewdev/kit';

import type { ListPageDefinition, ListPageV1 } from '../contract/v1';

import { FieldCell, IdentityCell } from './cells';
import type { KindColumn, KindDefinition, KindField, KindRow } from './definition';
import { tableDefaultSort, tableSort } from './sortKey';
import { useKindPage } from './useKindPage';

// The list page of a kind, stated as data: the definition's words, columns and quick filters, with a cell drawn for each column. The host's list page draws it. This is the ONE
// list contribution: every kind's page is `listPage(definition)`, and nothing here knows which kind it is given.

function fieldOf<TRow extends KindRow>(kind: KindDefinition<TRow>, id: string): KindField<TRow> {
  const field = kind.fields.find((candidate) => candidate.id === id);
  if (field === undefined) {
    throw new Error(`The ${kind.kind} definition has no field ${id}`);
  }

  return field;
}

/** The tile and the name over its namespace: the first 28 px of the cell are the tile and its gap. */
const NAME_LEAD = 28;

/**
 * A table column from the definition's column: its label, how it takes width, its width, its side, and how it sorts: the column's `sort` (the mock's comparison) and its field's `sortValue` are the key the table sorts
 * by (`sortKey.ts`), the same for every column of every kind (the mock sorts every column but a sensitive one, and no kind here has one). The cell is the kind's field, drawn.
 */
function tableColumn<TRow extends KindRow>(kind: KindDefinition<TRow>, spec: KindColumn): DataTableColumn<TRow> {
  const field = fieldOf(kind, spec.id);
  const column = {
    id: spec.id,
    header: spec.label,
    fit: spec.fit,
    // The identity column takes what is left and has no width of its own; `width` is the floor the definition gives a flex column and the width of a fixed one.
    width: spec.fit === 'fixed' ? spec.width : undefined,
    align: spec.align === 'right' ? 'end' : 'start',
    ...tableSort(spec.sort, field.sortValue),
  } as const;
  if (spec.fit === 'id') {
    return {
      ...column,
      lead: NAME_LEAD,
      cell: (row) => <IdentityCell kind={kind} row={row} />,
      // What the fit measures: the name over its namespace, and the end of the name that stays whole when it is cut.
      text: (row) => [{ text: row.name }, { text: kind.list.identity.second(row) ?? '', font: 'small' }],
      keepEnd: (row) => kind.list.identity.tail(row),
    };
  }

  return { ...column, cell: (row) => <FieldCell field={field} row={row} /> };
}

/**
 * The columns the list shows by default (`defaultHidden` ones wait for the Columns chooser, plan 1a.9), each with its sort key, and the sort the list opens in (the kind's `list.defaultSort`: the host's list page
 * says it in that header and sorts by it; the rows the data hook hands over are in that order too, so a host that does not sort draws the same order). A kind whose mock definition has no quick filters has no strip: a strip
 * with only All filters nothing. Every list has two lines in a row, whether or not its kind has a second line: the rows of the mock's lists are all 40 px (measured, K2b-1).
 */
export function listDefinition<TRow extends KindRow>(kind: KindDefinition<TRow>): ListPageDefinition<TRow> {
  return {
    title: kind.nouns.other,
    nouns: kind.nouns,
    columns: kind.columns.filter((column) => !column.defaultHidden).map((column) => tableColumn(kind, column)),
    defaultSort: tableDefaultSort(kind.list.defaultSort),
    lines: 2,
    getRowKey: (row) => row.key,
    searchText: kind.model.searchText,
    ...(kind.list.quickFilters.length === 0
      ? {}
      : {
        quickFilters: {
          // "Pod state": what the filters are about, named in the singular as the mock names it.
          label: `${kind.kind} state`,
          filters: kind.list.quickFilters,
        },
      }),
  };
}

// The list page as the plugin contributes it (`contributionV1.pages`): its definition, which the host's list page draws, and its one data hook. The return type is where the page's types meet
// the contract's: a definition or a source the host's list page cannot draw does not compile here.
export function listPage<TRow extends KindRow>(kind: KindDefinition<TRow>): ListPageV1<TRow> {
  return { kind: 'list', definition: listDefinition(kind), usePage: (context) => useKindPage(kind, context) };
}
