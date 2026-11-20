import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';

import { serviceObject, type ServicePort } from './object';

/** What the list holds of one Service. A field the object does not hold is undefined. */
export type ServiceRow = KindRow & {
  /** `spec.type`: kubectl's TYPE. */
  readonly type: string | undefined;
  /** `spec.clusterIP`: kubectl's CLUSTER-IP. `None` for a headless Service; an ExternalName Service has none. */
  readonly clusterIP: string | undefined;
  /** Each port as kubectl prints it (`80/TCP`, `80:30080/TCP`): kubectl's PORT(S). A Service with no ports has none. */
  readonly ports: readonly string[] | undefined;
};

/**
 * A port as kubectl says it (`makePortString`): the port, its node port after a colon, and the protocol. The API defaults the protocol to TCP, so an object that states none is read so, and a port
 * that states no number is `*`, as the mock says it.
 */
export const portText = ({ port, nodePort, protocol }: ServicePort): string => `${port ?? '*'}${nodePort === undefined ? '' : `:${nodePort}`}/${protocol ?? 'TCP'}`;

// The Services' rows: one per record object, computed once (`../rows.ts`). A Service with no spec says nothing of its type, address or ports: the list shows dashes. An empty list of ports is none.
export const { row: serviceRow, rows: serviceRows, searchText: serviceSearchText } = rowModel(
  (host): ServiceRow => {
    const service = serviceObject(host);
    const { spec } = service;
    return {
      ...identityOf(host, service, false),
      type: spec?.type,
      clusterIP: spec?.clusterIP === '' ? undefined : spec?.clusterIP,
      ports: spec?.ports === undefined || spec.ports.length === 0 ? undefined : spec.ports.map(portText),
    };
  },
  (row) => [row.name, row.namespace, row.type, row.clusterIP, ...(row.ports ?? [])],
);
