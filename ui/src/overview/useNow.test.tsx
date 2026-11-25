import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNow } from './useNow';

// The overview judges a claim by how long it has been Pending, and nothing in the data changes when five minutes pass. `useNow` is the instant the overview judges by: the one it was mounted at, and again at each
// instant the data says something turns, so that a claim that crosses the line is on the page without a reload and without a timer per claim.

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useNow: the instant the page is judged at', () => {
  it('is the instant it was mounted at, and sets no timer when the data names no instant to look again at', () => {
    const { result } = renderHook(() => useNow(() => undefined));

    expect(result.current).toBe(NOW);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(3_600_000);
    });
    expect(result.current).toBe(NOW);
  });

  it('is read again at the instant the data names, and not before', () => {
    const turns = NOW + 5_000;
    const { result } = renderHook(() => useNow((now) => (now < turns ? turns : undefined)));

    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(result.current).toBe(NOW);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(turns);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is read again for each instant in turn: the next one after the one it has reached', () => {
    const instants = [NOW + 1_000, NOW + 3_000];
    const { result } = renderHook(() => useNow((now) => instants.find((instant) => instant > now)));

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(NOW + 1_000);

    act(() => {
      vi.advanceTimersByTime(1_999);
    });
    expect(result.current).toBe(NOW + 1_000);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(NOW + 3_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('looks again at the new instant when the data changes the one it waits for, and forgets the old one', () => {
    let turns: number | undefined = NOW + 10_000;
    const { result, rerender } = renderHook(() => useNow(() => turns));

    turns = NOW + 2_000;
    rerender();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current).toBe(NOW + 2_000);

    // The instant it waited for before is not asked for again: nothing is left to wait for.
    turns = undefined;
    rerender();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is never behind the instant it was woken for, even when the clock it reads has not got there: the data would name the same instant again, and it would wait for ever', () => {
    const slow = vi.fn(() => NOW);
    const turns = NOW + 1_000;
    const { result } = renderHook(() => useNow((now) => (now < turns ? turns : undefined), slow));

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(turns);
  });

  it('drops its timer when the page goes', () => {
    const { unmount } = renderHook(() => useNow(() => NOW + 5_000));
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
