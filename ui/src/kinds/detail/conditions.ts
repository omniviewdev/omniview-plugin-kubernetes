import type { StateRole } from '../status';

// The Conditions of any object, as the mock draws them (MOCK `conditionRole`, `conditionsSection`; K59 and K61.3): one table of roles for every kind, because a condition has one role wherever
// it is said. The Pod page's table (`pod/overview/model.ts`) is the same rule, and `conditions.test.ts` holds the two to the same answers.

/** What a condition of an object says, as the API serves it. */
export type ConditionInput = {
  readonly type?: string | undefined;
  readonly status?: string | undefined;
  readonly reason?: string | undefined;
  readonly message?: string | undefined;
  readonly lastTransitionTime?: string | undefined;
};

export type ConditionRow = {
  readonly key: string;
  readonly type: string;
  readonly role: StateRole;
  readonly status: string;
  readonly reason: string | undefined;
  /** What the condition says in words: the tip of its type and its reason. */
  readonly message: string | undefined;
  /** Epoch milliseconds. */
  readonly changedAt: number | undefined;
};

/** A condition whose `True` is a problem: pressure, a failure (a Namespace's deletion has three: discovery, group versions, content), an unavailable network. */
const ADVERSE = /^(?:.*Pressure|.*Failure|NetworkUnavailable|Failed|Degraded|Dangling|Stalled|Throttled)$/;

/** A condition that says what remains of work still going: `True` while it is in progress, `False` once nothing is left (what remains of a Namespace that is being deleted: its content, its finalizers). */
const REMAINING = /^.*Remaining$/;

/** A type that names readiness or completion, or a failure: when it is bad news it is an error, not only a thing to look at. */
const MEANS_TROUBLE = /^(?:Ready|Available|ContainersReady|Established|Healthy|Complete|Failed|ReplicaFailure|Degraded)$/;

/**
 * The role a condition is drawn with: `True` is healthy unless the type is an adverse one; a bad one of a type that names readiness is an error, any other bad one needs attention. A condition of what remains
 * is the work in progress while it is `True`, and healthy while it is `False`. The deletion conditions of a Namespace follow what they say, not the mock's table (which has no pattern for them and reads a
 * `False` failure as attention and a `True` remainder as healthy: the inverse): the lead's ruling for K2c-1, recorded in the status file's Spec errata.
 */
export function conditionRole(type: string, status: string | undefined): StateRole {
  if (REMAINING.test(type) && (status === 'True' || status === 'False')) {
    return status === 'True' ? 'progress' : 'healthy';
  }

  const good = status === 'True' ? !ADVERSE.test(type) : status === 'False' ? ADVERSE.test(type) : undefined;
  if (good === undefined) {
    return 'attention';
  }

  return good ? 'healthy' : MEANS_TROUBLE.test(type) ? 'error' : 'attention';
}

const present = (value: string | undefined): string | undefined => (value === undefined || value === '' ? undefined : value);

/** One row per condition, in the order the API gives them. An object with none has no rows, and its section is not drawn. */
export function conditionRows(conditions: readonly ConditionInput[] | undefined): readonly ConditionRow[] {
  return (conditions ?? []).map((condition, index) => {
    const type = condition.type ?? '';
    const changed = Date.parse(condition.lastTransitionTime ?? '');
    return {
      key: `${type}:${index}`,
      type,
      role: conditionRole(type, condition.status),
      status: condition.status ?? 'Unknown',
      reason: present(condition.reason),
      message: present(condition.message),
      changedAt: Number.isFinite(changed) ? changed : undefined,
    };
  });
}
