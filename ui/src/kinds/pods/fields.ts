import type { Ratio } from '../definition';

import type { PodObject } from './pod';

// What each column of the Pods list says, derived from the object a cluster served (docs/ui-next/slices/1a-pods-list.md 1.3).
// A value the object does not hold is undefined: the cell draws a dash with its reason, never 0, an empty string or a word (ch13 D7).

/** Regular containers that report ready, over the containers the spec declares. Undefined when the spec has no containers list. */
export function podReady(pod: PodObject): Ratio | undefined {
  const containers = pod.spec?.containers;
  if (containers === undefined) {
    return undefined;
  }

  return { ready: (pod.status?.containerStatuses ?? []).filter((status) => status.ready === true).length, total: containers.length };
}

/** The sum of the restarts of the regular containers. Undefined when no status was reported, or any count is missing (plan E4). */
export function podRestarts(pod: PodObject): number | undefined {
  const statuses = pod.status?.containerStatuses;
  if (statuses === undefined || statuses.some((status) => status.restartCount === undefined)) {
    return undefined;
  }

  return statuses.reduce((sum, status) => sum + (status.restartCount ?? 0), 0);
}

export function podNode(pod: PodObject): string | undefined {
  const node = pod.spec?.nodeName;
  return node === undefined || node === '' ? undefined : node;
}

/** `status.podIP`, else the first of `status.podIPs`, which is the one kubectl prints. */
export function podIP(pod: PodObject): string | undefined {
  const address = pod.status?.podIP ?? pod.status?.podIPs?.[0]?.ip;
  return address === undefined || address === '' ? undefined : address;
}
