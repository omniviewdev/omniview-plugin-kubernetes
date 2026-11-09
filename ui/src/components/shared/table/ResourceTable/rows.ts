import { valueToJSON, type HostRecord } from '@omniviewdev/runtime';
import type { KubernetesResourceObject } from '../../../../types/resource';

// Source views retain unchanged records across patches. Retain their decoded
// bodies too, so one live update does not replace every table row and metric target.
const bodies = new WeakMap<HostRecord, KubernetesResourceObject>();

/** Decode presentation bodies while retaining host-issued row membership and identity. */
export function decodeResourceTableRows(records: readonly HostRecord[]) {
  const recordsByBody = new WeakMap<object, HostRecord>();
  const rowKeys: string[] = [];
  const rows = records.map((record) => {
    let body = bodies.get(record);
    if (!body) {
      body = valueToJSON(record.record.body) as KubernetesResourceObject;
      bodies.set(record, body);
    }
    recordsByBody.set(body, record);
    rowKeys.push(record.key);
    return body;
  });
  return { rows, recordsByBody, rowKeys };
}
