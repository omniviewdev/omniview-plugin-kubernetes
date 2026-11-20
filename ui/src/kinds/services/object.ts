import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, count, isObject, metadataOf, objects, text, type ObjectMeta } from '../object';

// The part of a Service that the list reads: its type, its cluster address and its ports. A Service of type ExternalName has no cluster address and may have no ports, and the API omits what is empty.
// Anything the object does not hold is absent here, and stays absent downstream (`../object.ts`).

export type ServicePort = {
  readonly port?: number;
  readonly nodePort?: number;
  readonly protocol?: string;
};

export type ServiceObject = {
  readonly metadata?: ObjectMeta;
  readonly spec?: { readonly type?: string; readonly clusterIP?: string; readonly ports?: readonly ServicePort[] };
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toService(value: unknown): ServiceObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec } = value;
  return {
    metadata: metadataOf(metadata),
    spec: isObject(spec)
      ? {
        type: text(spec.type),
        clusterIP: text(spec.clusterIP),
        ports: objects(spec.ports)?.map((port) => ({ port: count(port.port), nodePort: count(port.nodePort), protocol: text(port.protocol) })),
      }
      : undefined,
  };
}

/** The Service a record holds. A body that is not a Service gives an empty one, never an error: one odd object must not take the list down. */
export function serviceObject(host: HostRecord): ServiceObject {
  return toService(bodyOf(host));
}
