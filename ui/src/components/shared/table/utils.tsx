import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { type Column, type RowData } from '@tanstack/react-table';
import { type CSSProperties } from 'react';

/**
 * Width and pinning styles for a body cell. Mirrors base-ui DataTable's
 * header sizing (resizable columns grow in proportion to their size, fixed
 * ones keep their width) so body cells line up with DataTable.Header.
 */
export const getBodyCellStyles = <T extends RowData,>(column: Column<DataTableFeatures, T, unknown>): CSSProperties => {
  const size = `var(--col-${column.id}-size)`;
  const isPinned = column.getIsPinned();
  const styles: CSSProperties = {
    flex: column.getCanResize() ? `${size} 0 0px` : `0 0 calc(${size} * 1px)`,
    width: `calc(${size} * 1px)`,
  };
  if (!isPinned) return styles;

  const isLastLeft = isPinned === 'start' && column.getIsLastColumn('start');
  const isFirstRight = isPinned === 'end' && column.getIsFirstColumn('end');
  return {
    ...styles,
    position: 'sticky',
    zIndex: 1,
    insetInlineStart: isPinned === 'start' ? `${column.getStart('start')}px` : undefined,
    insetInlineEnd: isPinned === 'end' ? `${column.getAfter('end')}px` : undefined,
    boxShadow: isLastLeft
      ? '-4px 0 4px -4px rgb(0 0 0 / 0.12) inset'
      : isFirstRight
        ? '4px 0 4px -4px rgb(0 0 0 / 0.12) inset'
        : undefined,
  };
};
