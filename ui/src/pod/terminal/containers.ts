import type { PodDetail } from '../data/object';

/** The name selects a regular container; its observed ID and restart count fence reuse. None become contributor input. */
export type RunningContainer = {
  readonly container: string;
  readonly containerID: string;
  readonly containerRestart: string;
};

/** Pair the regular spec containers accepted by this plugin's exec handler with their actual, running incarnations. */
export function runningContainers(pod: PodDetail): readonly RunningContainer[] {
  if (
    pod.status.phase !== 'Running' ||
    pod.metadata.deletionTimestamp ||
    !pod.spec.containers ||
    !pod.status.containerStatuses
  )
    return [];
  const statuses = new Map(pod.status.containerStatuses.map((status) => [status.name, status]));
  return pod.spec.containers.flatMap(({ name }) => {
    const status = statuses.get(name);
    const id = status?.containerID;
    const restart = status?.restartCount;
    return name &&
      status?.state?.running &&
      id &&
      id.length <= 256 &&
      restart !== undefined &&
      Number.isSafeInteger(restart) &&
      restart >= 0
      ? [{ container: name, containerID: id, containerRestart: String(restart) }]
      : [];
  });
}
