import type { ShellCount } from '../contract/shell';

// The scheduler of the sidebar's counts, with no React in it. The sidebar wants a count for each kind that is on screen, and the runtime has no hook that reads a number of them (a hook cannot run in a loop, and
// the number of kinds changes with the groups that are open), so the reads go through a small pool of slots: each slot is one hook (`useSidebarCounts`'s `useCountSlot`) that reads one kind at a time. This
// store says which kind each slot reads, from what is wanted, and takes what the reads answered.
//
//   - What is wanted is a list of jobs in row order (the order of the sidebar). A job is due when it has no answer or its answer is older than REFRESH_MS.
//   - At most SLOTS jobs are being read at once. `settle` records an answer and frees the slot, and the next due job of the list takes it.
//   - `want` replaces the list. A job that is no longer wanted is dropped from its slot, which cancels its read (the slot's hook stops asking for it); the same list again changes nothing and tells nobody.
//   - The answers of jobs that are no longer wanted are kept for the interval, so a group that is opened again within it asks for nothing, and are forgotten after it.
//   - A refusal is final until the user asks again: a read the user may not make (`refuse`) is never due by the clock, since a 403 asked again every minute is noise in a cluster's audit log for exactly the users who
//     get one. The wish forgets it, at once, as soon as it no longer names the kind: so the kind is asked once more when its group is opened again, when the connection or the scope changed, or when its list was
//     visited, and not otherwise.
//   - A timer asks again at the earliest time an answer falls due. The clock is injected.

/** How many count reads are in flight at once: the backend's `CountConcurrency` (`pkg/plugin/resource/clients/count_reads.go`), which runs at most this many of a connection's count reads at a time. */
export const SLOTS = 4;

/**
 * How old an answer is, in milliseconds, before its kind is read again. The backend keeps an answer 30 s (`CountStaleness`) and answers a read inside that time from it, so a shorter interval would be
 * asking for what it already has; a count is read again, at most, once in this time.
 */
export const REFRESH_MS = 60_000;

/** What the store needs of a job: the key that says which read it is. It carries what the slot's read asks for beside it. */
export type Keyed = { readonly key: string };

export type CountSnapshot<TJob extends Keyed> = {
  /** The job each slot reads, by slot; undefined while the slot is free. The job is the object that was wanted when the slot took it. */
  readonly slots: ReadonlyArray<TJob | undefined>;
  /** What the last read of each key said: a number, an approximate number, or `null` (it draws nothing). A read that failed, or was refused, says `null`. */
  readonly answers: ReadonlyMap<string, ShellCount | null>;
};

export type CountStore<TJob extends Keyed> = {
  subscribe: (listener: () => void) => () => void;
  /** The same object until a slot changes hands or an answer is recorded. */
  getSnapshot: () => CountSnapshot<TJob>;
  /** Replaces what is wanted. */
  want: (jobs: readonly TJob[]) => void;
  /** The read of `key` in `slot` has answered. Ignored when `key` is not what that slot reads: the slot was handed on, or the read is the one of a store that has since been reset. */
  settle: (slot: number, key: string, count: ShellCount | null) => void;
  /** The read of `key` in `slot` was refused (the user may not make it): as `settle` with no count, and the key is not asked for again while the wish goes on naming it. It is asked for again when the wish drops it and names it again. */
  refuse: (slot: number, key: string) => void;
  /** Forgets everything: what is wanted, what the slots read, what was answered. For a connection that is not the one the answers were read from. */
  reset: () => void;
};

export function createCountStore<TJob extends Keyed>(now: () => number): CountStore<TJob> {
  let wanted: readonly TJob[] = [];
  let slots: ReadonlyArray<TJob | undefined> = Array.from({ length: SLOTS }, () => undefined);
  let answers: ReadonlyMap<string, ShellCount | null> = new Map();
  /** When each answer was recorded. */
  let answeredAt = new Map<string, number>();
  /** The keys whose last read was refused: they fall due only when they have left the wish. */
  const refused = new Set<string>();
  let snapshot: CountSnapshot<TJob> = { slots, answers };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  /** Tells the listeners, if a slot or an answer is not what the snapshot holds. */
  function publish(): void {
    if (snapshot.slots !== slots || snapshot.answers !== answers) {
      snapshot = { slots, answers };
      for (const listener of [...listeners]) {
        listener();
      }
    }
  }

  function stop(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  /**
   * Makes the slots what the wish and the clock say: a job that is not wanted leaves its slot, and the free slots take the jobs that are due, in the order of the wish. Forgets the answers that are old and no
   * longer wanted, and the refusals that are no longer wanted at once. Sets the timer for the earliest answer that will fall due. It does not tell the listeners; `publish` does.
   */
  function plan(): void {
    const at = now();
    const keys = new Set(wanted.map((job) => job.key));

    const lapsed = [...refused].filter((key) => !keys.has(key));
    if (lapsed.length > 0) {
      for (const key of lapsed) {
        refused.delete(key);
        answeredAt.delete(key);
      }

      answers = new Map([...answers].filter(([key]) => !lapsed.includes(key)));
    }

    const next = slots.map((job) => (job !== undefined && keys.has(job.key) ? job : undefined));
    const busy = new Set(next.flatMap((job) => (job === undefined ? [] : [job.key])));
    let soonest = Infinity;
    for (const job of wanted) {
      if (busy.has(job.key) || refused.has(job.key)) {
        continue;
      }

      const answered = answeredAt.get(job.key);
      const due = answered === undefined ? at : answered + REFRESH_MS;
      if (due > at) {
        soonest = Math.min(soonest, due);
        continue;
      }

      // A job that is due and finds no slot free waits: the next `settle` frees one and plans again.
      const free = next.indexOf(undefined);
      if (free !== -1) {
        next[free] = job;
        busy.add(job.key);
      }
    }

    if (next.some((job, slot) => job !== slots[slot])) {
      slots = next;
    }

    const old = [...answeredAt].filter(([key, answered]) => !keys.has(key) && answered + REFRESH_MS <= at).map(([key]) => key);
    if (old.length > 0) {
      for (const key of old) {
        answeredAt.delete(key);
      }

      answers = new Map([...answers].filter(([key]) => !old.includes(key)));
    }

    stop();
    if (soonest !== Infinity) {
      timer = setTimeout(() => {
        timer = undefined;
        plan();
        publish();
      }, soonest - at);
    }
  }

  /** Records what the read of `key` in `slot` answered, frees the slot and plans again. A refusal is marked before the plan, so that no timer is set for it. */
  function answer(slot: number, key: string, count: ShellCount | null, refusal: boolean): void {
    if (slots[slot]?.key !== key) {
      return;
    }

    slots = slots.map((job, index) => (index === slot ? undefined : job));
    answers = new Map(answers).set(key, count);
    answeredAt.set(key, now());
    if (refusal) {
      refused.add(key);
    }

    plan();
    publish();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot: () => snapshot,

    want(jobs) {
      const unique = new Map<string, TJob>();
      for (const job of jobs) {
        if (!unique.has(job.key)) {
          unique.set(job.key, job);
        }
      }

      wanted = [...unique.values()];
      plan();
      publish();
    },

    settle(slot, key, count) {
      answer(slot, key, count, false);
    },

    refuse(slot, key) {
      answer(slot, key, null, true);
    },

    reset() {
      stop();
      wanted = [];
      answeredAt = new Map();
      refused.clear();
      if (slots.some((job) => job !== undefined)) {
        slots = Array.from({ length: SLOTS }, () => undefined);
      }

      if (answers.size > 0) {
        answers = new Map();
      }

      publish();
    },
  };
}
