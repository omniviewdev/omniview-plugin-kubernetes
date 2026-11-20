import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, count, isObject, metadataOf, objects, text, type ObjectMeta } from '../object';

// The part of an EndpointSlice that the list reads: its address type, its ports, and the addresses of its endpoints. The readiness of an endpoint (`conditions`) is not read: the mock's list does not, and
// kubectl does not print it. The API writes `null` for the ports and the endpoints of a slice that has none. Anything the object does not hold is absent here, and stays absent downstream
// (`../object.ts`).

export type SlicePort = {
  readonly port?: number;
  readonly protocol?: string;
};

export type EndpointSliceObject = {
  readonly metadata?: ObjectMeta;
  readonly addressType?: string;
  /** Absent when the object holds no `ports`. */
  readonly ports?: readonly SlicePort[];
  /** Every address of every endpoint, in order. Absent when the object holds no `endpoints`. */
  readonly addresses?: readonly string[];
};

/** A text the API gives, or undefined when it is absent or empty: an empty address type or protocol states nothing. */
const named = (value: unknown): string | undefined => {
  const found = text(value);
  return found === '' ? undefined : found;
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toEndpointSlice(value: unknown): EndpointSliceObject {
  if (!isObject(value)) {
    return {};
  }

  return {
    metadata: metadataOf(value.metadata),
    addressType: named(value.addressType),
    ports: objects(value.ports)?.map((port) => ({ port: count(port.port), protocol: named(port.protocol) })),
    addresses: objects(value.endpoints)?.flatMap((endpoint) => (Array.isArray(endpoint.addresses) ? endpoint.addresses.filter((address): address is string => typeof address === 'string' && address !== '') : [])),
  };
}

/** The EndpointSlice a record holds. A body that is not one gives an empty one, never an error: one odd object must not take the list down. */
export function endpointSliceObject(host: HostRecord): EndpointSliceObject {
  return toEndpointSlice(bodyOf(host));
}
