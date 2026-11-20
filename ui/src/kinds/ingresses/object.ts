import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, isObject, metadataOf, objects, text, type ObjectMeta } from '../object';

// The part of an Ingress that the list reads: its class, the hosts of its rules, whether it has a TLS section, and the addresses its load balancer has. The API omits what is empty. Anything the object
// does not hold is absent here, and stays absent downstream (`../object.ts`).

export type IngressObject = {
  readonly metadata?: ObjectMeta;
  readonly spec?: {
    readonly ingressClassName?: string;
    /** The host of each rule, in order; a rule that names none is the empty string. Absent when the spec holds no `rules`. */
    readonly hosts?: readonly string[];
    /** How many entries the TLS section has. Absent when the spec holds none. */
    readonly tls?: number;
  };
  /** The address of each entry of the load balancer: its IP, else its host name. Absent when the status holds no load balancer entry. */
  readonly addresses?: readonly string[];
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toIngress(value: unknown): IngressObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec, status } = value;
  const balancer = isObject(status) && isObject(status.loadBalancer) ? objects(status.loadBalancer.ingress) : undefined;
  return {
    metadata: metadataOf(metadata),
    spec: isObject(spec)
      ? { ingressClassName: text(spec.ingressClassName), hosts: objects(spec.rules)?.map((rule) => text(rule.host) ?? ''), tls: objects(spec.tls)?.length }
      : undefined,
    addresses: balancer?.flatMap((entry) => text(entry.ip) ?? text(entry.hostname) ?? []),
  };
}

/** The Ingress a record holds. A body that is not an Ingress gives an empty one, never an error: one odd object must not take the list down. */
export function ingressObject(host: HostRecord): IngressObject {
  return toIngress(bodyOf(host));
}
