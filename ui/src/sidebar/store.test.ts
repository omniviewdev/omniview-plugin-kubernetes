import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCountStore, REFRESH_MS, SLOTS, type CountStore } from './store';

// The scheduler of the sidebar's counts, with no React in it: what is wanted, in row order; four slots, the backend's CountConcurrency, that the reads go through; what each read answered and when; and the
// timer that asks again when an answer is old. The React side (`useSidebarCounts`) only puts what a slot's read says into `settle`.

type Job = { readonly key: string };
const job = (key: string): Job => ({ key });
const jobs = (...keys: readonly string[]): readonly Job[] => keys.map(job);

type Store = CountStore<Job>;
const create = (now: () => number = () => Date.now()): Store => createCountStore<Job>(now);

/** The key each slot reads, by slot; undefined for a slot that is free. */
const reading = (store: Store): ReadonlyArray<string | undefined> => store.getSnapshot().slots.map((slot) => slot?.key);
const answers = (store: Store): Readonly<Record<string, unknown>> => Object.fromEntries(store.getSnapshot().answers);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the slots: four reads at once, in the order of the wish', () => {
  it('has four slots, the number of count reads the backend runs at a time (CountConcurrency), and all are free to begin with', () => {
    expect(SLOTS).toBe(4);
    expect(reading(create())).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('gives the first keys of the wish to the slots, in the order of the wish', () => {
    const store = create();

    store.want(jobs('a', 'b', 'c', 'd', 'e', 'f'));

    expect(reading(store)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never has more than four keys in its slots, however many are wanted', () => {
    const store = create();

    store.want(jobs(...Array.from({ length: 29 }, (_, index) => `kind-${String(index)}`)));

    expect(reading(store).filter((key) => key !== undefined)).toHaveLength(4);
  });

  it('leaves slots free when the wish is shorter than four', () => {
    const store = create();

    store.want(jobs('a', 'b'));

    expect(reading(store)).toEqual(['a', 'b', undefined, undefined]);
  });

  it('takes a key named twice as one key', () => {
    const store = create();

    store.want(jobs('a', 'b', 'a', 'c', 'b'));

    expect(reading(store)).toEqual(['a', 'b', 'c', undefined]);
  });

  it('hands over the job it was given, for the slot\'s read to read what to ask from', () => {
    const store = createCountStore<{ readonly key: string; readonly type: string }>(() => Date.now());
    const pods = { key: 'k1', type: 'k8s:/pods' };

    store.want([pods]);

    expect(store.getSnapshot().slots[0]).toBe(pods);
  });
});

describe('settle: an answer frees the slot, and the next key that is due takes it', () => {
  it('frees the slot of the key that settled and gives it to the next one of the wish', () => {
    const store = create();
    store.want(jobs('a', 'b', 'c', 'd', 'e', 'f'));

    store.settle(1, 'b', 5);

    expect(reading(store)).toEqual(['a', 'e', 'c', 'd']);
    expect(answers(store)).toEqual({ b: 5 });

    store.settle(0, 'a', 7);

    expect(reading(store)).toEqual(['f', 'e', 'c', 'd']);
    expect(answers(store)).toEqual({ a: 7, b: 5 });
  });

  it('leaves the slot free when nothing else is due: the keys left have their answers, or are in a slot', () => {
    const store = create();
    store.want(jobs('a', 'b'));

    store.settle(0, 'a', 1);

    expect(reading(store)).toEqual([undefined, 'b', undefined, undefined]);
  });

  it('records what it is told: a number, an approximate number, or none', () => {
    const store = create();
    store.want(jobs('a', 'b', 'c'));

    store.settle(0, 'a', 12);
    store.settle(1, 'b', { value: 1200, approximate: true });
    store.settle(2, 'c', null);

    expect(answers(store)).toEqual({ a: 12, b: { value: 1200, approximate: true }, c: null });
  });

  it('keeps the last answer of a key', () => {
    const store = create();
    store.want(jobs('a'));
    store.settle(0, 'a', 1);
    vi.advanceTimersByTime(REFRESH_MS);
    expect(reading(store)[0]).toBe('a');

    store.settle(0, 'a', 2);

    expect(answers(store)).toEqual({ a: 2 });
  });

  it('ignores the settling of a key that is not the job of that slot: the slot was handed on, or the read never was this key\'s', () => {
    const store = create();
    store.want(jobs('a', 'b', 'c', 'd', 'e', 'f'));
    store.want(jobs('a', 'c', 'd', 'f', 'g'));
    expect(reading(store)).toEqual(['a', 'f', 'c', 'd']);
    const before = store.getSnapshot();

    store.settle(1, 'b', 5);
    store.settle(2, 'a', 5);
    store.settle(0, 'zzz', 5);

    expect(store.getSnapshot()).toBe(before);
    expect(answers(store)).toEqual({});
  });

  it('ignores the settling of a slot that is free, and of a slot there is not', () => {
    const store = create();
    store.want(jobs('a'));
    const before = store.getSnapshot();

    store.settle(3, 'a', 1);
    store.settle(4, 'a', 1);
    store.settle(-1, 'a', 1);

    expect(store.getSnapshot()).toBe(before);
  });

  it('gives a due key that had to wait the first slot that frees, and not before', () => {
    const store = create();
    store.want(jobs('a', 'b', 'c', 'd', 'e'));
    store.settle(0, 'a', 1);
    store.settle(0, 'e', 1);
    expect(reading(store)).toEqual([undefined, 'b', 'c', 'd']);

    vi.advanceTimersByTime(REFRESH_MS);
    // a and e are due together; one slot is free.
    expect(reading(store)).toEqual(['a', 'b', 'c', 'd']);

    store.settle(1, 'b', 1);

    expect(reading(store)).toEqual(['a', 'e', 'c', 'd']);
  });
});

describe('the interval: an answer is not asked for again until it is old', () => {
  it('does not ask for a key it has an answer for until the refresh interval has gone, and then asks again by itself', () => {
    expect(REFRESH_MS).toBe(60_000);
    const store = create();
    store.want(jobs('a'));
    store.settle(0, 'a', 3);
    expect(reading(store)).toEqual([undefined, undefined, undefined, undefined]);

    vi.advanceTimersByTime(REFRESH_MS - 1);
    expect(reading(store)).toEqual([undefined, undefined, undefined, undefined]);

    vi.advanceTimersByTime(1);
    expect(reading(store)).toEqual(['a', undefined, undefined, undefined]);
  });

  it('keeps the answer it has while it asks again: the number does not go blank during a refresh', () => {
    const store = create();
    store.want(jobs('a'));
    store.settle(0, 'a', 3);

    vi.advanceTimersByTime(REFRESH_MS);

    expect(reading(store)[0]).toBe('a');
    expect(answers(store)).toEqual({ a: 3 });
  });

  it('counts the interval from the answer, not from the ask', () => {
    const store = create();
    store.want(jobs('a'));
    vi.advanceTimersByTime(5_000);
    store.settle(0, 'a', 3);

    vi.advanceTimersByTime(REFRESH_MS - 1);
    expect(reading(store)[0]).toBeUndefined();

    vi.advanceTimersByTime(1);
    expect(reading(store)[0]).toBe('a');
  });

  it('sets its timer for the earliest answer that is due, and for the next one after it', () => {
    const store = create();
    store.want(jobs('a', 'b'));
    store.settle(0, 'a', 1);
    vi.advanceTimersByTime(10_000);
    store.settle(1, 'b', 2);

    vi.advanceTimersByTime(REFRESH_MS - 10_000);
    expect(reading(store)).toEqual(['a', undefined, undefined, undefined]);

    store.settle(0, 'a', 1);
    vi.advanceTimersByTime(10_000);
    expect(reading(store)).toEqual(['b', undefined, undefined, undefined]);
  });

  it('asks for what is due when the wish is made, if the timer that would have done it has not run: the clock is the one it was given', () => {
    let now = 0;
    const store = create(() => now);
    store.want(jobs('a'));
    store.settle(0, 'a', 1);

    now = REFRESH_MS - 1;
    store.want(jobs('a'));
    expect(reading(store)[0]).toBeUndefined();

    now = REFRESH_MS;
    store.want(jobs('a'));
    expect(reading(store)[0]).toBe('a');
  });

  it('records an answer of none like any other: it draws nothing, and it is asked for again after the interval and never at once', () => {
    const store = create();
    store.want(jobs('a', 'b'));

    store.settle(0, 'a', null);

    expect(answers(store)).toEqual({ a: null });
    expect(reading(store)).toEqual([undefined, 'b', undefined, undefined]);
    store.want(jobs('a', 'b'));
    expect(reading(store)).toEqual([undefined, 'b', undefined, undefined]);

    vi.advanceTimersByTime(REFRESH_MS - 1);
    expect(reading(store)[0]).toBeUndefined();

    vi.advanceTimersByTime(1);
    expect(reading(store)[0]).toBe('a');
  });

  it('leaves no timer running when nothing is to be asked later: the wish is empty, or every key of it is being read', () => {
    const store = create();
    expect(vi.getTimerCount()).toBe(0);

    store.want(jobs('a', 'b'));
    expect(vi.getTimerCount()).toBe(0);

    store.settle(0, 'a', 1);
    expect(vi.getTimerCount()).toBe(1);

    store.want([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs one timer, not one for each answer', () => {
    const store = create();
    store.want(jobs('a', 'b', 'c', 'd'));

    for (const [slot, key] of [[0, 'a'], [1, 'b'], [2, 'c'], [3, 'd']] as const) {
      store.settle(slot, key, 1);
    }

    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('refuse: a read the user may not make is not asked for again on a timer', () => {
  it('frees the slot like an answer, records no count, and gives the slot to the next key that is due', () => {
    const store = create();
    store.want(jobs('a', 'b', 'c', 'd', 'e'));

    store.refuse(0, 'a');

    expect(reading(store)).toEqual(['e', 'b', 'c', 'd']);
    expect(answers(store)).toEqual({ a: null });
  });

  it('never asks for it again by itself, however long it waits, and sets no timer for it', () => {
    const store = create();
    store.want(jobs('a'));

    store.refuse(0, 'a');

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5 * REFRESH_MS);
    expect(reading(store)).toEqual([undefined, undefined, undefined, undefined]);
    store.want(jobs('a'));
    expect(reading(store)).toEqual([undefined, undefined, undefined, undefined]);
    expect(answers(store)).toEqual({ a: null });
  });

  it('goes on asking for the keys that are not refused, at the interval: the refusal is the key\'s own', () => {
    const store = create();
    store.want(jobs('a', 'b'));
    store.refuse(0, 'a');
    store.settle(1, 'b', null);

    vi.advanceTimersByTime(REFRESH_MS);

    expect(reading(store)).toEqual(['b', undefined, undefined, undefined]);
    store.settle(0, 'b', null);
    vi.advanceTimersByTime(4 * REFRESH_MS);
    expect(reading(store)).toEqual(['b', undefined, undefined, undefined]);
    expect(reading(store)).not.toContain('a');
  });

  it('asks for it once more when the wish drops it and names it again at once: a refusal is not kept for the interval as an answer is', () => {
    const store = create();
    store.want(jobs('a', 'b'));
    store.refuse(0, 'a');
    store.settle(1, 'b', 7);

    store.want(jobs('b'));
    store.want(jobs('a', 'b'));

    expect(reading(store)).toEqual(['a', undefined, undefined, undefined]);
  });

  it('asks for it once more when the wish names it again after any time, and for nothing more', () => {
    const store = create();
    store.want(jobs('a'));
    store.refuse(0, 'a');
    store.want([]);
    vi.advanceTimersByTime(10 * REFRESH_MS);

    store.want(jobs('a'));
    expect(reading(store)).toEqual(['a', undefined, undefined, undefined]);
    store.refuse(0, 'a');
    vi.advanceTimersByTime(10 * REFRESH_MS);

    expect(reading(store)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('forgets the refusal, and the answer of none that stood for it, when the wish drops it', () => {
    const store = create();
    store.want(jobs('a', 'b'));
    store.refuse(0, 'a');
    store.settle(1, 'b', 7);

    store.want(jobs('b'));

    expect(answers(store)).toEqual({ b: 7 });
  });

  it('forgets every refusal on a reset: the connection is not the one that refused', () => {
    const store = create();
    store.want(jobs('a'));
    store.refuse(0, 'a');

    store.reset();
    store.want(jobs('a'));

    expect(reading(store)).toEqual(['a', undefined, undefined, undefined]);
  });

  it('ignores the refusal of a key that is not the job of that slot, as it ignores a settling', () => {
    const store = create();
    store.want(jobs('a', 'b'));

    store.refuse(0, 'b');
    store.refuse(3, 'a');

    expect(reading(store)).toEqual(['a', 'b', undefined, undefined]);
    expect(answers(store)).toEqual({});
  });

  it('tells its listeners that the slot was freed and the answer recorded', () => {
    const store = create();
    store.want(jobs('a'));
    const listener = vi.fn();
    store.subscribe(listener);

    store.refuse(0, 'a');

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('want: the wish is replaced, and what it no longer names is dropped', () => {
  it('drops a key that is no longer wanted from its slot, and gives the slot to the next key that is due', () => {
    const store = create();
    store.want(jobs('a', 'b', 'c', 'd', 'e', 'f'));

    store.want(jobs('a', 'c', 'f', 'g'));

    // b and d were being read and no longer are; f and g take their slots, in the order of the wish.
    expect(reading(store)).toEqual(['a', 'f', 'c', 'g']);
  });

  it('drops every slot when the wish goes empty', () => {
    const store = create();
    store.want(jobs('a', 'b', 'c', 'd', 'e'));

    store.want([]);

    expect(reading(store)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('leaves a key that is still wanted where it is, whatever else changed: a read in flight is not started again', () => {
    const store = create();
    store.want(jobs('a', 'b', 'c', 'd', 'e'));
    const first = store.getSnapshot().slots[0];

    store.want([job('a'), job('x'), job('y'), job('z')]);

    expect(reading(store)).toEqual(['a', 'x', 'y', 'z']);
    expect(store.getSnapshot().slots[0]).toBe(first);
  });

  it('does not take a read in flight from its slot because the wish was put in another order', () => {
    const store = create();
    store.want(jobs('a', 'b', 'c', 'd', 'e'));

    store.want(jobs('e', 'd', 'c', 'b', 'a'));
    expect(reading(store)).toEqual(['a', 'b', 'c', 'd']);

    store.settle(0, 'a', 1);
    expect(reading(store)).toEqual(['e', 'b', 'c', 'd']);
  });

  it('keeps the answers of keys that are no longer wanted, so that a group opened again within the interval asks for nothing', () => {
    const store = create();
    store.want(jobs('a'));
    store.settle(0, 'a', 4);

    store.want([]);
    vi.advanceTimersByTime(10_000);
    store.want(jobs('a'));

    expect(reading(store)).toEqual([undefined, undefined, undefined, undefined]);
    expect(answers(store)).toEqual({ a: 4 });
  });

  it('asks again at once for a key that comes back after its answer is old', () => {
    const store = create();
    store.want(jobs('a'));
    store.settle(0, 'a', 4);
    store.want([]);
    vi.advanceTimersByTime(REFRESH_MS * 2);

    store.want(jobs('a'));

    expect(reading(store)[0]).toBe('a');
    expect(answers(store)).toEqual({ a: 4 });
  });

  it('forgets the answers that are old and no longer wanted, so what it keeps is bounded by what is on screen and the interval', () => {
    let now = 0;
    const store = create(() => now);
    store.want(jobs('a', 'b'));
    store.settle(0, 'a', 1);
    store.settle(1, 'b', 2);
    store.want(jobs('b'));

    // The clock moves; nothing has planned since, so nothing has been forgotten.
    now = REFRESH_MS;
    expect(answers(store)).toEqual({ a: 1, b: 2 });

    // What is still wanted keeps its answer while it is read again; what is not wanted and old goes.
    store.want(jobs('b', 'c'));

    expect(answers(store)).toEqual({ b: 2 });
  });

  it('has no answer for a key whose read was dropped, so the key is due again at once when it is wanted again', () => {
    const store = create();
    store.want(jobs('a', 'b', 'c', 'd'));
    store.want(jobs('b'));
    expect(reading(store)).toEqual([undefined, 'b', undefined, undefined]);

    store.want(jobs('a', 'b'));

    expect(reading(store)).toEqual(['a', 'b', undefined, undefined]);
  });
});

describe('who is told', () => {
  it('changes nothing and tells nobody when the same list is wanted again', () => {
    const store = create();
    const listener = vi.fn();
    store.want(jobs('a', 'b', 'c', 'd', 'e'));
    store.subscribe(listener);
    const before = store.getSnapshot();

    store.want(jobs('a', 'b', 'c', 'd', 'e'));
    store.want([job('a'), job('b'), job('c'), job('d'), job('e')]);

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
  });

  it('tells its listeners when a slot changes hands, and when an answer arrives', () => {
    const store = create();
    const listener = vi.fn();
    store.subscribe(listener);

    store.want(jobs('a', 'b'));
    expect(listener).toHaveBeenCalledTimes(1);

    store.settle(0, 'a', 1);
    expect(listener).toHaveBeenCalledTimes(2);

    store.want(jobs('b'));
    expect(listener).toHaveBeenCalledTimes(2);

    store.want([]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('tells its listeners when the timer hands a slot to a key that is due', () => {
    const store = create();
    store.want(jobs('a'));
    store.settle(0, 'a', 1);
    const listener = vi.fn();
    store.subscribe(listener);

    vi.advanceTimersByTime(REFRESH_MS);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops telling a listener that has unsubscribed', () => {
    const store = create();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.want(jobs('a'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('gives the same snapshot until something changes', () => {
    const store = create();
    store.want(jobs('a', 'b'));
    const first = store.getSnapshot();

    expect(store.getSnapshot()).toBe(first);

    store.settle(0, 'a', 1);

    expect(store.getSnapshot()).not.toBe(first);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });
});

describe('reset: the connection is not the one the answers were read from', () => {
  it('frees every slot, forgets every answer and stops the timer', () => {
    const store = create();
    store.want(jobs('a', 'b', 'c', 'd', 'e'));
    store.settle(0, 'a', 1);

    store.reset();

    expect(reading(store)).toEqual([undefined, undefined, undefined, undefined]);
    expect(answers(store)).toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tells its listeners, and leaves the store ready to be wished into again, from nothing', () => {
    const store = create();
    store.want(jobs('a', 'b'));
    store.settle(0, 'a', 1);
    const listener = vi.fn();
    store.subscribe(listener);

    store.reset();
    expect(listener).toHaveBeenCalledTimes(1);

    store.want(jobs('a', 'b'));
    expect(reading(store)).toEqual(['a', 'b', undefined, undefined]);
  });

  it('tells nobody when there is nothing to forget', () => {
    const store = create();
    const listener = vi.fn();
    store.subscribe(listener);

    store.reset();

    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores the settling of a read that began before it: it is not the slot\'s job any more', () => {
    const store = create();
    store.want(jobs('a'));

    store.reset();
    store.settle(0, 'a', 1);

    expect(answers(store)).toEqual({});
  });
});
