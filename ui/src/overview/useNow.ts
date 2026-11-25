import { useEffect, useState } from 'react';

/**
 * The instant the overview judges what it holds by: the one it was mounted at, and again at each instant `next` names. The overview calls a claim failing when it has been Pending for more than five minutes, and nothing
 * in the data changes when the five minutes pass, so the page has to look again by itself: `next(now)` says the first instant, after `now`, at which something it holds will turn (`nextStuck`), or nothing when no
 * instant is left, and one timer waits for it. A change in the data that moves that instant moves the timer; a page that goes takes it with it.
 *
 * What is read is never behind the instant it was woken for, so that `next` cannot name the same instant again however the clock it reads (`read`: the system's) is rounded or delayed.
 */
export function useNow(next: (now: number) => number | undefined, read: () => number = Date.now): number {
  const [now, setNow] = useState(read);
  const due = next(now);
  useEffect(() => {
    if (due === undefined) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setNow(Math.max(read(), due));
    }, Math.max(0, due - read()));
    return () => {
      clearTimeout(timer);
    };
  }, [due, read]);

  return now;
}
