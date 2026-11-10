import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { ColumnDef } from '@tanstack/react-table';
import { type ObjectMeta } from 'kubernetes-types/meta/v1';

import { DATA_ONLY_CELL_META } from '../../../../shared/table/types';
import ActionsCell from '../cells/ActionsCell';

import { ColumnArgs } from './types';

export const actionsColumn = <T extends { metadata?: ObjectMeta }>({
  connectionID,
  resourceKey,
}: ColumnArgs): ColumnDef<DataTableFeatures, T> => ({
  id: 'menu',
  cell: ({ row }) => (
    <ActionsCell
      connectionID={connectionID}
      resourceKey={resourceKey}
      resourceID={row.id}
      data={row.original}
      namespace={row.original.metadata?.namespace ?? ''}
    />
  ),
  size: 50,
  enableResizing: false,
  enableSorting: false,
  enableHiding: false,
  meta: DATA_ONLY_CELL_META,
});

export default actionsColumn;
