import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import { endpointsObject, type EndpointsSubset } from './object';

/** What the list holds of one Endpoints object. A field the object does not hold is undefined. */
export type EndpointsRow = KindRow & {
  /** Each ready address with each port as `ip:port`, in kubectl's order: for each subset, for each port, each address. A subset with no ports gives its addresses alone. Kubectl's ENDPOINTS, uncut. */
  readonly endpoints: readonly string[] | undefined;
};

/**
 * The entries of the subsets in the order `kubectl get endpoints` prints them (`formatEndpoints`): for each subset, for each port, each address as `ip:port`; a subset with no ports gives its addresses
 * alone. An address with a colon (IPv6) is in brackets before its port, as Go's `net.JoinHostPort` writes it. The mock's `addressesOf` walks address first and port second: the same entries, in another order.
 */
const entriesOf = (subsets: readonly EndpointsSubset[]): readonly string[] =>
  subsets.flatMap(({ addresses, ports }) =>
    ports.length === 0 ? addresses : ports.flatMap((port) => addresses.map((ip) => (port === undefined ? ip : `${ip.includes(':') ? `[${ip}]` : ip}:${port}`))));

// The Endpoints' rows: one per record object, computed once (`../rows.ts`). An object with no subset, or whose subsets hold no ready address, names no address: the list shows a dash.
export const { row: endpointsRow, rows: endpointsRows, searchText: endpointsSearchText } = rowModel(
  (host): EndpointsRow => {
    const endpoints = endpointsObject(host);
    const entries = endpoints.subsets === undefined ? [] : entriesOf(endpoints.subsets);
    return { ...identityOf(host, endpoints, false), endpoints: entries.length === 0 ? undefined : entries };
  },
  (row) => [row.name, row.namespace, ...(row.endpoints ?? [])],
);
