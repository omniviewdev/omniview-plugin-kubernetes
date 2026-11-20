import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, flag, isObject, metadataOf, objects, text, type ObjectMeta } from '../object';

// The part of a CronJob that the list reads. The API omits an empty list of active Jobs, so a status with none says so by holding no `active`; that is read in `row.ts`. Anything else the object
// does not hold is absent here, and stays absent downstream (`../object.ts`).

export type CronJobObject = {
  readonly metadata?: ObjectMeta;
  readonly spec?: { readonly schedule?: string; readonly suspend?: boolean };
  /** `active` is how many Jobs the status names. */
  readonly status?: { readonly active?: number; readonly lastScheduleTime?: string };
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toCronJob(value: unknown): CronJobObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec, status } = value;
  return {
    metadata: metadataOf(metadata),
    spec: isObject(spec) ? { schedule: text(spec.schedule), suspend: flag(spec.suspend) } : undefined,
    status: isObject(status) ? { active: objects(status.active)?.length, lastScheduleTime: text(status.lastScheduleTime) } : undefined,
  };
}

/** The CronJob a record holds. A body that is not a CronJob gives an empty one, never an error: one odd object must not take the list down. */
export function cronJobObject(host: HostRecord): CronJobObject {
  return toCronJob(bodyOf(host));
}
