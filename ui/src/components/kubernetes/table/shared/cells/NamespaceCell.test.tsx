import { dataTableFeatures } from '@omniviewdev/base-ui';
import { flexRender, useTable } from '@tanstack/react-table';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { expect, it } from 'vitest';

import { namespaceColumn } from '../columns/namespaceColumn';

type Row = { metadata: { name: string; namespace: string } };
const columns = [namespaceColumn<Row>()];
const rows: Row[] = [
  { metadata: { name: 'api', namespace: 'apps' } },
  { metadata: { name: 'dns', namespace: 'kube-system' } },
];

type Filterable = { getFilterValue: () => unknown; setFilterValue: (value: unknown) => void };
let namespaceColumnOfTable: () => Filterable;

/**
 * Cells are rendered from row data alone, as the virtual body keeps them: this table never
 * renders again for a state change, so a cell can only follow the filter through its own subscription.
 */
function Cells() {
  const table = useTable(
    { features: dataTableFeatures, columns, data: rows, getRowId: (row) => row.metadata.name },
    () => ({}),
  );
  namespaceColumnOfTable = () => table.getColumn('namespace')!;
  return <>{table.getRowModel().rows.map((row) => (
    <div key={row.id}>{row.getVisibleCells().map((cell) => (
      <React.Fragment key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</React.Fragment>
    ))}</div>
  ))}</>;
}

it('mounts the hover controls on first pointer entry and keeps them current with the table filter', async () => {
  const user = userEvent.setup();
  render(<Cells />);
  expect(screen.queryByRole('button', { name: 'Copy namespace' })).toBeNull();
  expect(screen.queryByTitle('Filter by this namespace')).toBeNull();

  await user.hover(screen.getByText('kube-system'));
  // Only the cell that was entered holds controls.
  expect(screen.getAllByRole('button', { name: 'Copy namespace' })).toHaveLength(1);
  await user.click(screen.getByTitle('Filter by this namespace'));
  expect(namespaceColumnOfTable().getFilterValue()).toEqual(['kube-system']);
  expect(screen.getByTitle('Remove namespace filter')).toBeVisible();

  // The filter changes from elsewhere, as the toolbar's namespace selector does.
  act(() => namespaceColumnOfTable().setFilterValue(['apps']));
  expect(screen.getByTitle('Filter by this namespace')).toBeVisible();
  expect(screen.queryByTitle('Remove namespace filter')).toBeNull();
  await user.click(screen.getByTitle('Filter by this namespace'));
  expect(namespaceColumnOfTable().getFilterValue()).toEqual(['apps', 'kube-system']);
});

it('copies the namespace', async () => {
  const user = userEvent.setup();
  render(<Cells />);
  await user.hover(screen.getByText('apps'));
  await user.click(screen.getByRole('button', { name: 'Copy namespace' }));
  expect(await navigator.clipboard.readText()).toBe('apps');
});
