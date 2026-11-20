import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, isObject, metadataOf, objects, text, type ObjectMeta } from '../object';

// The part of a LimitRange that the list reads: the entries of `spec.limits` and the type each of them limits (Container, Pod or PersistentVolumeClaim). What an entry allows (its defaults, minimums and
// maximums) is the mock's detail, not its list. Anything the object does not hold is absent here, and stays absent downstream (`../object.ts`).

export type LimitRangeItem = {
  /** What the entry limits: `Container`, `Pod` or `PersistentVolumeClaim`. */
  readonly type?: string;
};

export type LimitRangeObject = {
  readonly metadata?: ObjectMeta;
  /** The entries of `spec.limits` that are objects. Absent when the spec holds no list. */
  readonly spec?: { readonly limits?: readonly LimitRangeItem[] };
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toLimitRange(value: unknown): LimitRangeObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec } = value;
  return {
    metadata: metadataOf(metadata),
    spec: isObject(spec) ? { limits: objects(spec.limits)?.map((limit) => ({ type: text(limit.type) })) } : undefined,
  };
}

/** The LimitRange a record holds. A body that is not a LimitRange gives an empty one, never an error: one odd object must not take the list down. */
export function limitRangeObject(host: HostRecord): LimitRangeObject {
  return toLimitRange(bodyOf(host));
}
