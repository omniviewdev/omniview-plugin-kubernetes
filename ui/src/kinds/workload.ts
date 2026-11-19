// The state word of a Deployment, a StatefulSet or a DaemonSet: the mock's rule (MOCK k8s-resource-definitions.js `workloadState`, K61.3). kubectl prints no such word for these kinds: it prints
// the counts, and the word is what a person reads in them. The first rule that holds decides.

/** The counts the rule reads, each the API's own: what is wanted, what is ready, what is available, what runs the current template (Deployment, StatefulSet) or is scheduled up to date (DaemonSet). */
export type WorkloadCounts = {
  /** A paused rollout (`spec.paused` of a Deployment). */
  readonly paused: boolean;
  readonly desired: number;
  readonly ready: number;
  readonly available: number;
  readonly updated: number;
};

/** The six words the rule can say, in the order the rule tries them, the last being the one of a workload that is well. */
export const WORKLOAD_STATES = ['Paused', 'Scaled to zero', 'Unavailable', 'Partially ready', 'Progressing', 'Available'] as const;

export type WorkloadState = (typeof WORKLOAD_STATES)[number];

export function workloadState({ paused, desired, ready, available, updated }: WorkloadCounts): WorkloadState {
  if (paused) {
    return 'Paused';
  }

  if (desired === 0) {
    return 'Scaled to zero';
  }

  if (available === 0) {
    return 'Unavailable';
  }

  if (ready < desired) {
    return 'Partially ready';
  }

  return updated < desired ? 'Progressing' : 'Available';
}
