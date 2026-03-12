import TableSortLabel from '@mui/material/TableSortLabel';
import {
  type ColumnSizingState,
  type Table,
  flexRender,
} from '@tanstack/react-table';
import React from 'react';

import type { KubernetesResourceObject } from '../../../../types/resource';

import { getCommonPinningStyles } from '../utils';

import { sortLabelSx } from './styles';

type ResourceTableHeaderProps = {
  table: Table<KubernetesResourceObject>;
  columnSizeVars: Record<string, number>;
  columnSizing: ColumnSizingState;
};

const ResourceTableHeader: React.FC<ResourceTableHeaderProps> = ({
  table,
  columnSizeVars: _columnSizeVars,
  columnSizing,
}) => (
  <thead
    style={{
      display: 'grid',
      position: 'sticky',
      top: 0,
      zIndex: 1,
    }}
  >
    {table.getHeaderGroups().map((headerGroup) => (
      <tr key={headerGroup.id} style={{ display: 'flex', width: '100%' }}>
        {headerGroup.headers.map((header) => {
          const flexMeta = (
            header.column.columnDef.meta as { flex?: number | undefined }
          )?.flex;
          const isUserResized = header.column.id in (columnSizing ?? {});
          const applyFlex = flexMeta && !isUserResized;
          return (
            <th
              key={header.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
                width: `calc(var(--header-${header.id}-size) * 1px)`,
                padding: '0px 8px',
                height: 32,
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: 'var(--ov-fg-muted)',
                backgroundColor: 'var(--ov-bg-surface)',
                borderBottom: '1px solid var(--ov-border-default)',
                whiteSpace: 'nowrap',
                userSelect: 'none',
                letterSpacing: '0.01em',
                position: 'relative',
                ...(applyFlex && {
                  minWidth: `calc(var(--header-${header.id}-size) * 1px)`,
                  flex: flexMeta,
                }),
                ...getCommonPinningStyles(header.column, true),
              }}
            >
              {header.isPlaceholder ? null : header.column.getCanSort() ? (
                <TableSortLabel
                  active={!!header.column.getIsSorted()}
                  direction={header.column.getIsSorted() === 'desc' ? 'desc' : 'asc'}
                  onClick={header.column.getToggleSortingHandler()}
                  sx={sortLabelSx}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableSortLabel>
              ) : (
                flexRender(header.column.columnDef.header, header.getContext())
              )}
              {header.column.getCanResize() && (
                // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                <div
                  onMouseDown={header.getResizeHandler()}
                  onTouchStart={header.getResizeHandler()}
                  onDoubleClick={() => header.column.resetSize()}
                  className={`resize-handle ${table.getState().columnSizingInfo.isResizingColumn === header.column.id ? 'isResizing' : ''}`}
                />
              )}
            </th>
          );
        })}
      </tr>
    ))}
  </thead>
);

export default ResourceTableHeader;
