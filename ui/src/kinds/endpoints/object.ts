import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, count, isObject, metadataOf, objects, text, type ObjectMeta } from '../object';

// The part of an Endpoints object that the list reads: for each subset, the IPs of its ready addresses and the numbers of its ports. The addresses that are not ready (`notReadyAddresses`) are not read:
// the list says where traffic goes now. The API omits what is empty, so an object with no ready address has no `subsets` at all. Anything the object does not hold is absent here, and stays absent
// downstream (`../object.ts`).

export type EndpointsSubset = {
  /** The IP of each ready address, in order. */
  readonly addresses: readonly string[];
  /** The number of each port, in order: undefined for a port that states none. */
  readonly ports: ReadonlyArray<number | undefined>;
};

export type EndpointsObject = {
  readonly metadata?: ObjectMeta;
  /** Absent when the object holds no `subsets`. */
  readonly subsets?: readonly EndpointsSubset[];
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. An address that has no IP, or an empty one, is not read: it names nothing. */
function toEndpoints(value: unknown): EndpointsObject {
  if (!isObject(value)) {
    return {};
  }

  return {
    metadata: metadataOf(value.metadata),
    subsets: objects(value.subsets)?.map((subset) => ({
      addresses: objects(subset.addresses)?.flatMap((address) => text(address.ip) ?? []).filter((ip) => ip !== '') ?? [],
      ports: objects(subset.ports)?.map((port) => count(port.port)) ?? [],
    })),
  };
}

/** The Endpoints object a record holds. A body that is not one gives an empty one, never an error: one odd object must not take the list down. */
export function endpointsObject(host: HostRecord): EndpointsObject {
  return toEndpoints(bodyOf(host));
}
