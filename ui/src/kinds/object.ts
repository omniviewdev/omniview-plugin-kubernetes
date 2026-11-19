import { valueToJSON, type HostRecord } from '@omniviewdev/runtime/ui/v1';

// What every kind's decoder reads an object with. A record body is an exact `Value` tree, not a Kubernetes object: `valueToJSON` is the presentation projection (integers become
// numbers, timestamps stay strings). A decoder keeps a field only when it has the type the API gives it, so anything the object does not hold is absent in what it returns, and
// stays absent downstream: nothing here turns a missing field into 0, an empty string or a word.

export type Json = Readonly<Record<string, unknown>>;

export const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
export const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
export const count = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
export const flag = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
export const objects = (value: unknown): readonly Json[] | undefined => (Array.isArray(value) ? value.filter(isObject) : undefined);

/** The part of `metadata` every list reads: what the object is called, where it lives, when it was made and whether it is going away. */
export type ObjectMeta = {
  readonly name?: string;
  readonly namespace?: string;
  readonly creationTimestamp?: string;
  readonly deletionTimestamp?: string;
};

export function metadataOf(value: unknown): ObjectMeta | undefined {
  return isObject(value)
    ? { name: text(value.name), namespace: text(value.namespace), creationTimestamp: text(value.creationTimestamp), deletionTimestamp: text(value.deletionTimestamp) }
    : undefined;
}

/** The presentation projection of a record's body: what a decoder reads. */
export const bodyOf = (host: HostRecord): unknown => valueToJSON(host.record.body);
