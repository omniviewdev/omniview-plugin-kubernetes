import type { ShellCount } from '../contract/shell';

// The counts of the lists that are open. A list that is on screen knows how many objects its kind has, live and from the very source it lists, so the sidebar draws that number for the kind and does not ask for
// it a second time (`useSidebarCounts`). The list and the sidebar are two components of the host that share nothing but this module, so it is module-level: a list publishes the count it knows while it is
// mounted (`useKindPage`) and takes it back when it goes, and the sidebar reads what is published.
//
// A list is published under the plugin, the connection and the type it reads. Keep-alive tabs keep their lists mounted, so every list that is mounted speaks for its kind; two lists of one kind (a kind
// open in two tabs) both speak, the later one first, and the kind stays open until both are gone.

export type OpenCounts = ReadonlyMap<string, ShellCount | null>;

type Publication = { readonly key: string; readonly count: ShellCount | null };

/** The lists that are open, in the order they opened. */
let publications: readonly Publication[] = [];
/** What the sidebar reads: the same map until a count is published or withdrawn. */
let snapshot: OpenCounts = new Map();
const listeners = new Set<() => void>();

/** Which list a count is of. The parts are encoded, so that no name can pass for the join of two others. */
export function openKey(plugin: string, connection: string, type: string): string {
  return JSON.stringify([plugin, connection, type]);
}

function change(next: readonly Publication[]): void {
  publications = next;
  // A later publication of a key replaces an earlier one in the map: the later list speaks.
  snapshot = new Map(next.map(({ key, count }) => [key, count]));
  for (const listener of [...listeners]) {
    listener();
  }
}

/**
 * Says that the list of `key` is open and knows `count` (`null`: it is open and has no number to say yet, which is still a list the sidebar need not ask about). Returns what takes the count back:
 * call it when the list goes. It does nothing the second time.
 */
export function publishOpenCount(key: string, count: ShellCount | null): () => void {
  const publication: Publication = { key, count };
  change([...publications, publication]);
  return () => {
    if (publications.includes(publication)) {
      change(publications.filter((candidate) => candidate !== publication));
    }
  };
}

export function getOpenCounts(): OpenCounts {
  return snapshot;
}

export function subscribeOpenCounts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forgets every list. For tests, which share this module: a list that was open before it takes nothing back after it. */
export function resetOpenCounts(): void {
  if (publications.length > 0) {
    change([]);
  }
}
