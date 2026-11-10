export type IdAccessor = string | ((data: object) => string);

export type ColumnMeta = {
  meta?: {
    flex?: number;
    dataTableCellDependencies?: 'data';
  };
};

/**
 * Column meta for cells whose renderers read the row's data and nothing else. The base-ui
 * virtual body then keeps a cell while its row data and column layout stay the same, instead
 * of rendering it again for every selection, sort, filter or search change. Such a renderer
 * must not read row or table state, and must subscribe on its own to anything else it shows.
 */
export const DATA_ONLY_CELL_META = { dataTableCellDependencies: 'data' } as const;
