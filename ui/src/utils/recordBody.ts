import { valueToJSON, type HostRecord } from '@omniviewdev/runtime';
import type { KubernetesResourceObject } from '../types/resource';

// Source views retain unchanged records across patches. Retain their decoded
// bodies too, so one live update does not replace every table row and metric target.
// Every table, drawer and view of a record shares its retained body, so a body is read-only:
// an editor keeps its own draft and never writes to the row it was opened from.
const bodies = new WeakMap<HostRecord, KubernetesResourceObject>();

/** Decode a record's presentation body once per HostRecord object; callers must not mutate it. */
export function decodeRecordBody(record: HostRecord): KubernetesResourceObject {
  let body = bodies.get(record);
  if (body === undefined) {
    body = valueToJSON(record.record.body) as KubernetesResourceObject;
    bodies.set(record, body);
  }
  return body;
}
