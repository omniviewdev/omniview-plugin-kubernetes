import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostRecord } from '@omniviewdev/runtime';

const decode = vi.hoisted(() => vi.fn());
vi.mock('@omniviewdev/runtime', () => ({ valueToJSON: decode }));
import { decodeRecordBody } from './recordBody';

function record(key: string): HostRecord {
  return { key, record: { body: { kind: 'map', value: { key } } } } as unknown as HostRecord;
}

describe('decodeRecordBody', () => {
  beforeEach(() => {
    decode.mockReset();
    decode.mockImplementation((value: { value: { key: string } }) => ({ decoded: value.value.key }));
  });

  it('returns the identical body for the same HostRecord and decodes once', () => {
    const one = record('one');
    expect(decodeRecordBody(one)).toBe(decodeRecordBody(one));
    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledWith(one.record.body);
  });

  it('decodes only the replaced record after a live update', () => {
    const [a, b, c] = [record('a'), record('b'), record('c')];
    const before = [a, b, c].map(decodeRecordBody);
    expect(decode).toHaveBeenCalledTimes(3);

    const b2 = record('b');
    const after = [a, b2, c].map(decodeRecordBody);
    expect(decode).toHaveBeenCalledTimes(4);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(after[1]).not.toBe(before[1]);
  });
});
