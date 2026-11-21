import { describe, expect, it } from 'vitest';

import type { Ratio } from './definition';
import { MAX_TOTAL, ratioKey, tableDefaultSort, tableSort } from './sortKey';

// The comparisons of the mock (MOCK k8s-resources.js:384-397 `compareBy`) as keys the kit's table sorts by: one key a row, text in natural order or a number, a missing value last in either direction. The mock's
// own comparison of two ratios, as it is written there:
//   const x = ratioOf(a), y = ratioOf(b);  (x[1] ? x[0] / x[1] : 1) - (y[1] ? y[0] / y[1] : 1) || x[1] - y[1]
const mockRatio = (a: Ratio, b: Ratio): number => (a.total === 0 ? 1 : a.ready / a.total) - (b.total === 0 ? 1 : b.ready / b.total) || a.total - b.total;

const rowOf = <T>(value: T) => ({ value });
const keyOf = (kind: Parameters<typeof tableSort>[0], value: unknown) => tableSort<never>(kind, (() => value) as never).sortKey?.(rowOf(value) as never);

describe('a ratio sorts by its fraction, then by its total (the unhealthiest first when ascending)', () => {
  const ratios: Ratio[] = [];
  for (let total = 0; total <= 12; total += 1) {
    for (let ready = 0; ready <= total; ready += 1) {
      ratios.push({ ready, total });
    }
  }

  ratios.push({ ready: 1999, total: 2000 }, { ready: 2000, total: 2000 }, { ready: 9999, total: MAX_TOTAL }, { ready: 4999, total: 9999 });

  it('orders every pair of ratios as the mock does: the fraction decides, a tie of fractions goes to the smaller total', () => {
    for (const a of ratios) {
      for (const b of ratios) {
        expect(Math.sign(ratioKey(a) - ratioKey(b)), `${String(a.ready)}/${String(a.total)} against ${String(b.ready)}/${String(b.total)}`).toBe(Math.sign(mockRatio(a, b)));
      }
    }
  });

  it('puts 1/1 before 2/2 (both whole, the smaller total first), 0/1 before 0/2, and 1/2 between them and the whole ones', () => {
    const order = [{ ready: 2, total: 2 }, { ready: 1, total: 2 }, { ready: 0, total: 2 }, { ready: 1, total: 1 }, { ready: 0, total: 1 }].sort((a, b) => ratioKey(a) - ratioKey(b));
    expect(order.map(({ ready, total }) => `${String(ready)}/${String(total)}`)).toEqual(['0/1', '0/2', '1/2', '1/1', '2/2']);
  });

  it('counts a total of 0 as whole, as the mock does', () => {
    expect(ratioKey({ ready: 0, total: 0 })).toBeGreaterThan(ratioKey({ ready: 9, total: 10 }));
    expect(Math.floor(ratioKey({ ready: 0, total: 0 }))).toBe(1);
  });
});

describe('tableSort: a column\'s comparison as the kit\'s key and kind', () => {
  it('text is the word, in the kit\'s text kind (natural order); an empty word and no word are a missing value', () => {
    expect(tableSort('text', () => 'pod-2').sortKind).toBe('text');
    expect(keyOf('text', 'pod-10')).toBe('pod-10');
    expect(keyOf('text', '')).toBeUndefined();
    expect(keyOf('text', undefined)).toBeUndefined();
  });

  it('a number is the number, in the kit\'s number kind (so 9 is before 10); no number is a missing value', () => {
    expect(tableSort('number', () => 9).sortKind).toBe('number');
    expect(keyOf('number', 10)).toBe(10);
    expect(keyOf('number', 0)).toBe(0);
    expect(keyOf('number', undefined)).toBeUndefined();
  });

  it('a time is its instant in milliseconds: ascending is the oldest first, an object with no instant is last', () => {
    const older = Date.parse('2026-10-01T10:00:00Z');
    const newer = Date.parse('2026-11-16T10:00:00Z');
    expect(tableSort('time', () => older).sortKind).toBe('number');
    expect(keyOf('time', older) as number).toBeLessThan(keyOf('time', newer) as number);
    expect(keyOf('time', undefined)).toBeUndefined();
  });

  it('a ratio is its key, in the kit\'s number kind; no ratio is a missing value', () => {
    expect(tableSort('ratio', () => ({ ready: 1, total: 2 })).sortKind).toBe('number');
    expect(keyOf('ratio', { ready: 1, total: 2 })).toBe(ratioKey({ ready: 1, total: 2 }));
    expect(keyOf('ratio', undefined)).toBeUndefined();
  });

  it('reads the value through the field and not through the row: one key function a column, whatever the row\'s shape', () => {
    const column = tableSort<{ readonly n: number }>('number', (row) => row.n);
    expect(column.sortKey?.({ n: 7 } as never)).toBe(7);
  });
});

describe('tableDefaultSort: the list\'s default in the table\'s words', () => {
  it('says ascending for asc and descending for desc, for the column named', () => {
    expect(tableDefaultSort({ id: 'name', direction: 'asc' })).toEqual({ column: 'name', direction: 'ascending' });
    expect(tableDefaultSort({ id: 'lastSeen', direction: 'desc' })).toEqual({ column: 'lastSeen', direction: 'descending' });
  });
});
