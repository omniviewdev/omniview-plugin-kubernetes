import { dataTableFeatures } from '@omniviewdev/base-ui';
import { flexRender, useTable } from '@tanstack/react-table';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { namespaceColumn } from '../columns/namespaceColumn';

type Row = { metadata: { name: string; namespace: string } };
const columns = [namespaceColumn<Row>()];
const rows: Row[] = [
  { metadata: { name: 'api', namespace: 'apps' } },
  { metadata: { name: 'dns', namespace: 'kube-system' } },
];

type Filterable = { getFilterValue: () => unknown; setFilterValue: (value: unknown) => void };

afterEach(() => vi.restoreAllMocks());

/**
 * Cells are rendered from row data alone, as the virtual body keeps them: this table never
 * renders again for a state change, so a cell can only follow the filter through its own subscription.
 */
function Cells({ columnRef }: { columnRef?: React.Ref<Filterable> }) {
  const table = useTable(
    { features: dataTableFeatures, columns, data: rows, getRowId: (row) => row.metadata.name },
    () => ({}),
  );
  React.useImperativeHandle(columnRef, () => table.getColumn('namespace')!, [table]);
  return <>{table.getRowModel().rows.map((row) => (
    <div key={row.id}>{row.getVisibleCells().map((cell) => (
      <React.Fragment key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</React.Fragment>
    ))}</div>
  ))}</>;
}

it('reveals the filter on pointer entry and keeps it current with the table filter', async () => {
  const user = userEvent.setup();
  const namespaceColumnOfTable = React.createRef<Filterable>();
  render(<Cells columnRef={namespaceColumnOfTable} />);
  expect(screen.queryByTitle('Filter by this namespace')).toBeNull();

  await user.hover(screen.getByText('kube-system'));
  await user.click(screen.getByTitle('Filter by this namespace'));
  expect(namespaceColumnOfTable.current!.getFilterValue()).toEqual(['kube-system']);
  expect(screen.getByTitle('Remove namespace filter')).toBeVisible();

  // The filter changes from elsewhere, as the toolbar's namespace selector does.
  act(() => namespaceColumnOfTable.current!.setFilterValue(['apps']));
  expect(screen.getByTitle('Filter by this namespace')).toBeVisible();
  expect(screen.queryByTitle('Remove namespace filter')).toBeNull();
  await user.click(screen.getByTitle('Filter by this namespace'));
  expect(namespaceColumnOfTable.current!.getFilterValue()).toEqual(['apps', 'kube-system']);
});

it('copies the namespace', async () => {
  const user = userEvent.setup();
  render(<Cells />);
  await user.hover(screen.getByText('apps'));
  await user.click(within(screen.getByText('apps').parentElement!).getByRole('button', { name: 'Copy namespace' }));
  expect(await navigator.clipboard.readText()).toBe('apps');
});

it('supports copying and toggling a namespace filter using only the keyboard', async () => {
  const user = userEvent.setup();
  const namespaceColumnOfTable = React.createRef<Filterable>();
  render(<Cells columnRef={namespaceColumnOfTable} />);
  const cell = within(screen.getByText('apps').parentElement!);
  await user.tab();
  expect(cell.getByRole('button', { name: 'Copy namespace' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(await navigator.clipboard.readText()).toBe('apps');
  await user.tab();
  expect(cell.getByRole('button', { name: 'Filter by this namespace' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(namespaceColumnOfTable.current!.getFilterValue()).toEqual(['apps']);
  await user.keyboard(' ');
  expect(namespaceColumnOfTable.current!.getFilterValue()).toEqual([]);
});

it('normalizes a non-array filter before adding the namespace', async () => {
  const user = userEvent.setup();
  const namespaceColumnOfTable = React.createRef<Filterable>();
  render(<Cells columnRef={namespaceColumnOfTable} />);
  act(() => namespaceColumnOfTable.current!.setFilterValue('apps'));
  await user.hover(screen.getByText('apps'));
  await user.click(screen.getByRole('button', { name: 'Filter by this namespace' }));
  expect(namespaceColumnOfTable.current!.getFilterValue()).toEqual(['apps']);
});

it('reports denied clipboard access and allows another copy attempt', async () => {
  const user = userEvent.setup();
  render(<Cells />);
  const write = vi.spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
  await user.hover(screen.getByText('apps'));
  const cell = within(screen.getByText('apps').parentElement!);
  const copy = cell.getByRole('button', { name: 'Copy namespace' });
  await user.click(copy);
  expect(cell.getByRole('status')).toHaveTextContent('Unable to copy namespace');
  expect(copy).toHaveAttribute('title', 'Unable to copy namespace');
  write.mockRestore();
  await user.click(copy);
  expect(await navigator.clipboard.readText()).toBe('apps');
  expect(cell.getByRole('status')).toHaveTextContent('Namespace copied');
});
