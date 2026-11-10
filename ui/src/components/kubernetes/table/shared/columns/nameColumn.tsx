import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { ColumnDef } from '@tanstack/react-table';

import { DATA_ONLY_CELL_META } from '../../../../shared/table/types';
import { CopyableCell } from '../cells/CopyableCell';

export const nameColumn = <T extends { metadata?: { name?: string } }>(): ColumnDef<DataTableFeatures, T> => ({
  id: 'name',
  header: 'Name',
  accessorKey: 'metadata.name',
  enableSorting: true,
  enableHiding: false,
  size: 300,
  minSize: 120,
  maxSize: 800,
  meta: {
    ...DATA_ONLY_CELL_META,
    flex: 1,
  },
  cell: CopyableCell,
});

export default nameColumn;
