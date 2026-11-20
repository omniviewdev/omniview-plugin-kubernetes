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

// The state word of a ReplicaSet: the mock's rule (`workloadState` of the mock for `ReplicaSet`) without the two things a ReplicaSet has none of, a paused rollout and a current template to be on,
// and with `Ready` for the one that is well. kubectl prints no state word for it either: its cells are the desired, current and ready counts.

/** The counts the rule reads, each the API's own. */
export type ReplicaSetCounts = Pick<WorkloadCounts, 'desired' | 'ready' | 'available'>;

/** The four words the rule can say, in the order the rule tries them, the last being the one of a ReplicaSet that is well. */
export const REPLICA_SET_STATES = ['Scaled to zero', 'Unavailable', 'Partially ready', 'Ready'] as const;

export type ReplicaSetState = (typeof REPLICA_SET_STATES)[number];

export function replicaSetState({ desired, ready, available }: ReplicaSetCounts): ReplicaSetState {
  if (desired === 0) {
    return 'Scaled to zero';
  }

  if (available === 0) {
    return 'Unavailable';
  }

  return ready < desired ? 'Partially ready' : 'Ready';
}
