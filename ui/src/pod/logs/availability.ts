import type { ContainerStatusDetail, PodDetail } from '../data/object';

// When a Pod cannot have logs. The API answers a read of the log of a container that never ran with "waiting to start" (ContainerCreating, ImagePullBackOff, PodInitializing), and there is no
// log to read of a Pod that was never placed on a node, so a session opened for such a Pod can only fail. The Logs command says so before it opens one, the way the kit's pattern for a command
// that cannot be used does: it stays where the design puts it, keeps its focus, does nothing, and the reason is its description. The rule is read from the record the page already holds, and the page
// holds it live, so the command is enabled by the render that follows the Pod's first container (K8G-41: no Pod read to decide it).

/** Why a Pod has no logs to show yet. The identity line of the header prints the first reason a labelled command has, so it is one sentence that says what to wait for. */
export const NOT_STARTED = 'No container of this Pod has started, so it has no logs yet.';

/** A container ran when it runs now, has finished, or is only known by the run before this one (it was restarted and is waiting again, as in a crash loop): a log file exists for each of those. */
function ran({ state, lastState }: ContainerStatusDetail): boolean {
  return state?.running !== undefined || state?.terminated !== undefined || lastState?.terminated !== undefined;
}

/**
 * The reason a Pod has no logs, or `undefined` when it may have some. Init and ephemeral (debug) containers count as well as the regular ones: a Pod that is still initializing has the log of the
 * init container that runs. A container the spec lists and the status does not know has not run.
 */
export function logsUnavailable({ status }: PodDetail): string | undefined {
  const statuses = [...(status.containerStatuses ?? []), ...(status.initContainerStatuses ?? []), ...(status.ephemeralContainerStatuses ?? [])];
  return statuses.some(ran) ? undefined : NOT_STARTED;
}
