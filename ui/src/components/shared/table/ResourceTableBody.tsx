import { useRightDrawer } from '@omniviewdev/runtime';
import { type RowSelectionState, type Table } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import React from 'react';

import type { KubernetesResourceObject } from '../../../types/resource';

import { type Props as ResourceTableProps } from './ResourceTable';
import ResourceTableRow from './ResourceTableRow';
// import ResourceTableRow from './ResourceTableRowContainer'

type Props = Omit<ResourceTableProps, 'columns' | 'idAccessor'> & {
  table: Table<KubernetesResourceObject>;
  tableContainerRef: React.RefObject<HTMLDivElement | null>;
  columnVisibility: string;
  resizedColumnIds: string;
  rowSelection: RowSelectionState;
};

const ResourceTableBody: React.FC<Props> = ({
  table,
  tableContainerRef,
  drawer,
  resourceKey,
  connectionID,
  memoizer,
  columnVisibility,
  resizedColumnIds,
  rowSelection,
}) => {
  const { rows } = table.getRowModel();
  const { openDrawer } = useRightDrawer();

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 30,
    overscan: 15,
  });

  /** Row Clicking */
  const onRowClick = React.useCallback(
    (id: string, data: KubernetesResourceObject) => {
      if (drawer === undefined) {
        return;
      }
      openDrawer(drawer, {
        data,
        resource: {
          id,
          name: data?.metadata?.name ?? id,
          key: resourceKey,
          connectionID,
          pluginID: 'kubernetes',
        },
      });
    },
    [drawer, connectionID, openDrawer, resourceKey],
  );

  return (
    <tbody
      style={{
        display: 'grid',
        height: `${virtualizer.getTotalSize()}px`, // Tells scrollbar how big the table is
        position: 'relative', // Needed for absolute positioning of rows
      }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index];
        return (
          <ResourceTableRow
            key={row.id}
            connectionID={connectionID}
            resourceID={row.id}
            resourceKey={resourceKey}
            row={row}
            memoizer={memoizer}
            virtualRow={virtualRow}
            isSelected={rowSelection[row.id]}
            columnVisibility={columnVisibility}
            resizedColumnIds={resizedColumnIds}
            onRowClick={onRowClick}
          />
        );
      })}
    </tbody>
  );
};

export default ResourceTableBody;
