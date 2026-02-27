import { ColumnDef } from '@tanstack/react-table';

import SelectCell from '../cells/SelectCell';
import SelectHeader from '../headers/SelectHeader';

export const selectColumn = <T extends { metadata?: { name?: string } }>(): ColumnDef<T> => ({
  id: 'select',
  header: SelectHeader,
  cell: SelectCell,
  size: 34,
  enableResizing: false,
  enableSorting: false,
  enableHiding: false,
});

export default selectColumn;
