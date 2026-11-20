import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, isObject, metadataOf, text, type ObjectMeta } from '../object';

// The part of a Namespace that the list reads: its phase, and whether it is marked for deletion (`metadata.deletionTimestamp`, which the API sets before it changes the phase). Anything the object
// does not hold is absent here, and stays absent downstream (`../object.ts`).

export type NamespaceObject = {
  readonly metadata?: ObjectMeta;
  readonly status?: { readonly phase?: string };
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toNamespace(value: unknown): NamespaceObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, status } = value;
  return { metadata: metadataOf(metadata), status: isObject(status) ? { phase: text(status.phase) } : undefined };
}

/** The Namespace a record holds. A body that is not a Namespace gives an empty one, never an error: one odd object must not take the list down. */
export function namespaceObject(host: HostRecord): NamespaceObject {
  return toNamespace(bodyOf(host));
}
