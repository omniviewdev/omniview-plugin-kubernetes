import { DataTable, dataTableFeatures } from '@omniviewdev/base-ui';
import { useTable, type ColumnFiltersState, type RowSelectionState } from '@tanstack/react-table';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DATA_ONLY_CELL_META } from '../../../../shared/table/types';

import { namespaceColumn, selectColumn } from './index';

type Row = { metadata: { name: string; namespace: string } };

const rows: Row[] = [
  { metadata: { name: 'api', namespace: 'apps' } },
  { metadata: { name: 'dns', namespace: 'kube-system' } },
  { metadata: { name: 'web', namespace: 'apps' } },
];

// The data-only cell records renders; the other cell displays selection state.
const dataOnly = vi.fn();
const columns = [
  selectColumn<Row>(),
  namespaceColumn<Row>(),
  {
    id: 'name', header: 'Name', accessorFn: (row: Row) => row.metadata.name, meta: DATA_ONLY_CELL_META,
    cell: ({ row }: { row: { id: string } }) => { dataOnly(row.id); return row.id; },
  },
  {
    id: 'plain', header: 'Plain', accessorFn: (row: Row) => row.metadata.name,
    cell: ({ row }: { row: { id: string; getIsSelected: () => boolean } }) => `plain-${row.id}-${row.getIsSelected() ? 'selected' : 'idle'}`,
  },
];

/** The resource table's state wiring: selection and filters are owned by the view, not the table. */
function Table() {
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId: (row) => row.metadata.name,
    state: { rowSelection, columnFilters },
    onRowSelectionChange: setRowSelection,
    onColumnFiltersChange: setColumnFilters,
  });
  return (
    <DataTable.Root table={table}>
      <DataTable.Container>
        <DataTable.Header />
        <DataTable.VirtualBody fixedRowHeight estimateRowSize={30} overscan={4} />
      </DataTable.Container>
    </DataTable.Root>
  );
}

beforeEach(() => {
  dataOnly.mockClear();
  // JSDOM has no layout: size the viewport so the virtual body mounts the rows.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
});
afterEach(() => vi.restoreAllMocks());

it('keeps the select and namespace cells current while the virtual body keeps data-only cells through state changes', async () => {
  const user = userEvent.setup();
  render(<Table />);
  const boxes = () => screen.getAllByRole('checkbox', { name: 'Select row' });
  expect(boxes()).toHaveLength(3);
  expect(dataOnly).toHaveBeenCalledTimes(3);

  await user.click(boxes()[1]);
  expect(boxes()[1]).toBeChecked();
  expect(boxes()[0]).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toHaveAttribute('aria-checked', 'mixed');
  expect(screen.getByText('plain-dns-selected')).toBeVisible();

  await user.hover(screen.getAllByText('kube-system')[0]);
  await user.click(screen.getByTitle('Filter by this namespace'));
  expect(screen.getByTitle('Remove namespace filter')).toBeVisible();
  // Rows outside the filter leave; the kept row stays selected.
  expect(screen.queryByText('apps')).toBeNull();
  expect(boxes()).toHaveLength(1);
  expect(boxes()[0]).toBeChecked();

  // Selecting and filtering leave the data-only cells untouched.
  expect(dataOnly).toHaveBeenCalledTimes(3);
});
