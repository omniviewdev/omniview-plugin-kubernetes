import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { Subscribe, type CellContext, type ColumnDef, type HeaderContext } from '@tanstack/react-table';

import { SelectCell } from '../cells/SelectCell';
import { SelectBoxHeader } from '../headers/SelectHeader';

/** Subscribe explicitly because TanStack keeps row and table references stable. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SelectCellWrapper = ({ row, table }: CellContext<DataTableFeatures, any, unknown>) => {
  return (
    <Subscribe source={table.atoms.rowSelection} selector={(selection) => !!selection[row.id]}>
      {(checked) => <SelectCell row={row} checked={checked} />}
    </Subscribe>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SelectHeaderWrapper = ({ table }: HeaderContext<DataTableFeatures, any, unknown>) => {
  return (
    <Subscribe source={table.store} selector={(state) => [state.rowSelection, state.columnFilters, state.globalFilter as unknown, state.pagination]}>
      {() => (
        <SelectBoxHeader
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onToggle={(checked) => table.toggleAllPageRowsSelected(checked)}
        />
      )}
    </Subscribe>
  );
};

export const selectColumn = <T extends { metadata?: { name?: string } }>(): ColumnDef<DataTableFeatures, T> => ({
  id: 'select',
  header: SelectHeaderWrapper,
  cell: SelectCellWrapper,
  size: 34,
  enableResizing: false,
  enableSorting: false,
  enableHiding: false,
});

export default selectColumn;
