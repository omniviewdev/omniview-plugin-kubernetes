import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import { endpointSliceObject, type SlicePort } from './object';

/** What the list holds of one EndpointSlice. A field the object does not hold is undefined. */
export type EndpointSliceRow = KindRow & {
  /** `addressType`: kubectl's ADDRESSTYPE (`IPv4`, `IPv6` or `FQDN`). */
  readonly addressType: string | undefined;
  /** Each port as `<number>/<protocol>`, in order: kubectl's PORTS, which prints the numbers alone. A slice with no ports has none. */
  readonly ports: readonly string[] | undefined;
  /** Every address of every endpoint, in order: kubectl's ENDPOINTS, uncut. A slice with no endpoints has none. */
  readonly endpoints: readonly string[] | undefined;
};

/**
 * A port as the mock says it (`portText`): the number and the protocol. The API defaults the protocol to TCP, so an object that states none is read so, and a port that states no number is `*`:
 * it is not restricted to one.
 */
const portText = ({ port, protocol }: SlicePort): string => `${port ?? '*'}/${protocol ?? 'TCP'}`;

// The EndpointSlices' rows: one per record object, computed once (`../rows.ts`). The name of a slice is generated (`kube-dns-jn2hf`: the Service's name and a suffix), so its end is kept whole when a cell
// cuts it. A slice with no ports, or no endpoint, says nothing of them: the list shows a dash.
export const { row: endpointSliceRow, rows: endpointSliceRows, searchText: endpointSliceSearchText } = rowModel(
  (host): EndpointSliceRow => {
    const slice = endpointSliceObject(host);
    const { ports, addresses } = slice;
    return {
      ...identityOf(host, slice, true),
      addressType: slice.addressType,
      ports: ports === undefined || ports.length === 0 ? undefined : ports.map(portText),
      endpoints: addresses === undefined || addresses.length === 0 ? undefined : addresses,
    };
  },
  (row) => [row.name, row.namespace, row.addressType, ...(row.ports ?? []), ...(row.endpoints ?? [])],
);
