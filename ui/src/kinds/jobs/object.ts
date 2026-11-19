import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, count, isObject, metadataOf, objects, text, type ObjectMeta } from '../object';

// The part of a Job that the list reads. The API omits a count that is zero (`omitempty`): see `../deployments/object.ts`. Anything else the object does not hold is absent here, and stays absent
// downstream (`../object.ts`).

export type JobCondition = {
  readonly type?: string;
  readonly status?: string;
};

export type JobObject = {
  readonly metadata?: ObjectMeta;
  readonly spec?: { readonly completions?: number; readonly parallelism?: number };
  readonly status?: {
    readonly succeeded?: number;
    readonly startTime?: string;
    readonly completionTime?: string;
    readonly conditions?: readonly JobCondition[];
  };
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toJob(value: unknown): JobObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec, status } = value;
  return {
    metadata: metadataOf(metadata),
    spec: isObject(spec) ? { completions: count(spec.completions), parallelism: count(spec.parallelism) } : undefined,
    status: isObject(status)
      ? {
        succeeded: count(status.succeeded),
        startTime: text(status.startTime),
        completionTime: text(status.completionTime),
        conditions: objects(status.conditions)?.map((condition) => ({ type: text(condition.type), status: text(condition.status) })),
      }
      : undefined,
  };
}

/** The Job a record holds. A body that is not a Job gives an empty one, never an error: one odd object must not take the list down. */
export function jobObject(host: HostRecord): JobObject {
  return toJob(bodyOf(host));
}
