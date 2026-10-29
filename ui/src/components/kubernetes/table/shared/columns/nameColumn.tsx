import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { ColumnDef } from '@tanstack/react-table';

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
    flex: 1,
  },
  cell: CopyableCell,
});

export default nameColumn;
