import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, isObject, metadataOf, type ObjectMeta } from '../object';

// The part of a ConfigMap that the list reads: the names of its keys and how many bytes its values come to. A ConfigMap's values are plain text (a Secret's are never read: `../secrets/object.ts`).
// The API omits an empty map, so an object with neither `data` nor `binaryData` holds no key. Anything else the object does not hold is absent here, and stays absent downstream (`../object.ts`).

export type ConfigMapObject = {
  readonly metadata?: ObjectMeta;
  /** Absent for a body that is not an object. */
  readonly entries?: {
    /** Every key of `data` and `binaryData`, once, in order. */
    readonly names: readonly string[];
    /** The bytes of the values together: the text of `data` as UTF-8, and the bytes a `binaryData` value decodes to. */
    readonly size: number;
  };
};

/** The bytes of a text as UTF-8, counted without encoding it: one to three for a code unit, four for a pair of surrogates. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let at = 0; at < text.length; at += 1) {
    const unit = text.charCodeAt(at);
    if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff && at + 1 < text.length) {
      bytes += 4;
      at += 1;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

/** The bytes a base64 text decodes to: three for each four characters, less one for each `=` of padding. */
function base64Length(text: string): number {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((text.length * 3) / 4) - padding);
}

/** The texts a map holds, by key: a value that is not a text counts for nothing. */
const textsOf = (value: unknown): ReadonlyArray<readonly [string, string]> =>
  isObject(value) ? Object.entries(value).flatMap(([key, entry]): ReadonlyArray<readonly [string, string]> => (typeof entry === 'string' ? [[key, entry]] : [])) : [];

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toConfigMap(value: unknown): ConfigMapObject {
  if (!isObject(value)) {
    return {};
  }

  const text = textsOf(value.data);
  const binary = textsOf(value.binaryData);
  return {
    metadata: metadataOf(value.metadata),
    entries: {
      names: [...new Set([...text, ...binary].map(([key]) => key))].sort(),
      size: text.reduce((sum, [, entry]) => sum + utf8Length(entry), 0) + binary.reduce((sum, [, entry]) => sum + base64Length(entry), 0),
    },
  };
}

/** The ConfigMap a record holds. A body that is not a ConfigMap gives an empty one, never an error: one odd object must not take the list down. */
export function configMapObject(host: HostRecord): ConfigMapObject {
  return toConfigMap(bodyOf(host));
}
