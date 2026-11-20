import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import { ingressObject } from './object';

/** What the list holds of one Ingress. A field the object does not hold is undefined. */
export type IngressRow = KindRow & {
  /** `spec.ingressClassName`: kubectl's CLASS. */
  readonly className: string | undefined;
  /** The host of each rule, once, in order, `*` for a rule that names none (it matches every host): kubectl's HOSTS. An Ingress with no rules has none. */
  readonly hosts: readonly string[] | undefined;
  /** The IP, else the host name, of each entry of the load balancer: kubectl's ADDRESS. An Ingress no controller has served has none. */
  readonly address: readonly string[] | undefined;
  /** `80, 443` when the spec has a TLS section and `80` when it has none (`formatPorts`): kubectl's PORTS. */
  readonly ports: string | undefined;
};

// The Ingresses' rows: one per record object, computed once (`../rows.ts`). An Ingress with no spec says nothing of its class, hosts or ports: the list shows dashes. An address that is not there yet is
// not a state of the Ingress (the mock gives it no status word), only an empty cell.
export const { row: ingressRow, rows: ingressRows, searchText: ingressSearchText } = rowModel(
  (host): IngressRow => {
    const ingress = ingressObject(host);
    const { spec, addresses } = ingress;
    const hosts = spec?.hosts === undefined ? undefined : [...new Set(spec.hosts.map((name) => (name === '' ? '*' : name)))];
    return {
      ...identityOf(host, ingress, false),
      className: spec?.ingressClassName,
      hosts: hosts === undefined || hosts.length === 0 ? undefined : hosts,
      address: addresses === undefined || addresses.length === 0 ? undefined : addresses,
      ports: spec === undefined ? undefined : (spec.tls ?? 0) > 0 ? '80, 443' : '80',
    };
  },
  (row) => [row.name, row.namespace, row.className, ...(row.hosts ?? []), ...(row.address ?? []), row.ports],
);
