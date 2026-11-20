import type { HostRecord, Value } from '@omniviewdev/runtime/ui/v1';

import type { ObjectMeta } from '../object';

// The part of a Secret that the list reads: its identity, its type and how many keys it has, and nothing that a key holds. The record's body is an exact `Value` tree, and this file walks it
// to those few members and counts the entries of `data`. It never converts the tree to JSON (that would read every value) and never looks into an entry: the values of `data`, `stringData`
// and the annotations (`last-applied-configuration` can hold the values whole) are not read by anything in the list, and a test hands it a record whose values throw when touched.

export type SecretObject = {
  readonly metadata?: ObjectMeta;
  readonly type?: string;
  /** How many keys `data` holds: zero when there is none (the API omits an empty map). Absent for a body that is not an object, or a `data` that is not a map. */
  readonly keys?: number;
};

const member = (value: Value | undefined, name: string): Value | undefined => (value?.kind === 'map' ? value.value[name] : undefined);

/** A text the API wrote: a string, or a timestamp (which the host may type apart from the strings). */
const textOf = (value: Value | undefined): string | undefined => (value?.kind === 'string' || value?.kind === 'timestamp' ? value.value : undefined);

/** The four members of `metadata` every list reads, taken one by one: the rest of it (labels, annotations) is left alone. */
function metadataOfValue(value: Value | undefined): ObjectMeta | undefined {
  return value?.kind === 'map'
    ? {
      name: textOf(member(value, 'name')),
      namespace: textOf(member(value, 'namespace')),
      creationTimestamp: textOf(member(value, 'creationTimestamp')),
      deletionTimestamp: textOf(member(value, 'deletionTimestamp')),
    }
    : undefined;
}

/** The Secret a record holds. A body that is not a Secret gives an empty one, never an error: one odd object must not take the list down. */
export function secretObject(host: HostRecord): SecretObject {
  const { body } = host.record;
  if (body.kind !== 'map') {
    return {};
  }

  const data = member(body, 'data');
  return {
    metadata: metadataOfValue(member(body, 'metadata')),
    type: textOf(member(body, 'type')),
    // The names of the keys are counted, and the values behind them are not touched.
    keys: data === undefined ? 0 : data.kind === 'map' ? Object.keys(data.value).length : undefined,
  };
}
