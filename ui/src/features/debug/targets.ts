import type { Pod } from 'kubernetes-types/core/v1';

export function runningDebugTargets(pod?: Pod): string[] {
  if (
    !pod?.metadata?.uid ||
    !pod.metadata.name ||
    !pod.metadata.namespace ||
    pod.metadata.deletionTimestamp ||
    pod.metadata.annotations?.['kubernetes.io/config.mirror'] ||
    ['Succeeded', 'Failed'].includes(pod.status?.phase ?? '')
  )
    return [];
  return (pod.spec?.containers ?? [])
    .filter((container) =>
      pod.status?.containerStatuses?.some(
        (status) => status.name === container.name && status.state?.running,
      ),
    )
    .map((container) => container.name);
}
export const isMissingShellError = (error: { title: string; suggestion: string; raw: string }) =>
  /(?:executable file not found|exec:.*(?:not found|no such file)|unable to start container process:.*(?:\/bin\/(?:ba)?sh|executable).*no such file)/i.test(
    error.raw,
  );
