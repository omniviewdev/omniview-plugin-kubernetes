import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';

import { useFilterOptions } from './filterOptions';

type Row = { node?: string; namespace?: string };

const filters = [
  { columnId: 'node', placeholder: 'All Nodes', accessor: (row: Row) => row.node },
  { columnId: 'namespace', placeholder: 'All Namespaces', accessor: (row: Row) => row.namespace },
];

it('lists the sorted distinct values of the value filters and leaves namespaces to their own list', () => {
  const rows: Row[] = [{ node: 'b', namespace: 'x' }, { node: 'a' }, { node: 'b' }, {}];
  const { result } = renderHook(() => useFilterOptions(rows, filters));
  expect(result.current).toEqual({ node: ['a', 'b'] });
});

it('keeps its arrays while the members stay the same and drops a value once no row has it', () => {
  const { result, rerender } = renderHook(
    ({ rows }: { rows: Row[] }) => useFilterOptions(rows, filters),
    { initialProps: { rows: [{ node: 'a' }, { node: 'b' }] } },
  );
  const held = result.current;
  // Replaced rows and a new order, as a sparse update delivers them.
  rerender({ rows: [{ node: 'b' }, { node: 'a' }] });
  expect(result.current).toBe(held);
  rerender({ rows: [{ node: 'b' }] });
  expect(result.current).toEqual({ node: ['b'] });
  expect(result.current.node).not.toBe(held.node);
});
