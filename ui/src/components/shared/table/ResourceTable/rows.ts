import type { HostRecord } from '@omniviewdev/runtime';
import { decodeRecordBody } from '../../../../utils/recordBody';

/** Decode presentation bodies while retaining host-issued row membership and identity. */
export function decodeResourceTableRows(records: readonly HostRecord[]) {
  const recordsByBody = new WeakMap<object, HostRecord>();
  const rowKeys: string[] = [];
  const rows = records.map((record) => {
    const body = decodeRecordBody(record);
    recordsByBody.set(body, record);
    rowKeys.push(record.key);
    return body;
  });
  return { rows, recordsByBody, rowKeys };
}
