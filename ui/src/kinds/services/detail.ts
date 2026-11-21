import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import type { KindCommands } from '../definition';
import { conditionRows, type ConditionInput } from '../detail/conditions';
import { annotationModels, labelModels } from '../detail/metadata';
import { conditionInputs, detailMeta, selectorOf, type DetailMeta } from '../detail/object';
import { facts, overviewModel, tagsFact, textFact, type KindOverview } from '../detail/overview';
import { selectorItems, type SelectorDetail } from '../detail/text';
import { bodyOf, isObject, objects, text, type Json } from '../object';

import { serviceRow } from './row';

// The page of one Service: what it says of the object a record holds, from the mock's `OVERVIEW.Service` (MOCK k8s-resource-definitions.js; K59). The values are the API's (decision A19) and the words are the
// mock's. The mock's header word (`Ready`, `No endpoints`) needs the Service's EndpointSlices, a related read this plugin does not have yet, so the header says none: a word made up from the spec alone
// would be a guess. The ports and the endpoints are not here either: the status file of K2c-1 says what each needs.

/** The part of a Service that its page reads, beyond what its list reads (`./object.ts`). */
export type ServiceDetail = {
  readonly metadata: DetailMeta;
  readonly spec: {
    readonly type?: string | undefined;
    readonly clusterIP?: string | undefined;
    readonly externalName?: string | undefined;
    /** The first of `spec.externalIPs`. */
    readonly externalIP?: string | undefined;
    readonly sessionAffinity?: string | undefined;
    readonly selector?: SelectorDetail | undefined;
  };
  /** What the balancer says it is reached by: the first ingress point's IP, or its hostname. */
  readonly balancer?: string | undefined;
  readonly conditions?: readonly ConditionInput[] | undefined;
};

const NOTHING: Json = {};

/** What the page reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
export function serviceDetail(host: HostRecord): ServiceDetail {
  const body = bodyOf(host);
  const { metadata, spec, status } = isObject(body) ? body : NOTHING;
  const specification = isObject(spec) ? spec : NOTHING;
  const state = isObject(status) ? status : NOTHING;
  const balancer = isObject(state.loadBalancer) ? state.loadBalancer : NOTHING;
  const ingress = objects(balancer.ingress)?.[0];
  return {
    metadata: detailMeta(metadata),
    spec: {
      type: text(specification.type),
      clusterIP: text(specification.clusterIP),
      externalName: text(specification.externalName),
      externalIP: Array.isArray(specification.externalIPs) ? specification.externalIPs.find((ip): ip is string => typeof ip === 'string' && ip !== '') : undefined,
      sessionAffinity: text(specification.sessionAffinity),
      selector: selectorOf(specification.selector, 'labels'),
    },
    balancer: [text(ingress?.ip), text(ingress?.hostname)].find((address) => address !== undefined && address !== ''),
    conditions: conditionInputs(state.conditions),
  };
}

export const serviceOverview = overviewModel((host): KindOverview => {
  const row = serviceRow(host);
  const { metadata, spec, balancer, conditions } = serviceDetail(host);
  const named = spec.type === 'ExternalName';
  return {
    state: undefined,
    createdAt: row.createdAt,
    summary: [],
    details: facts(
      textFact('type', 'Type', spec.type),
      // A headless Service has the word `None` for an address: said in words, since it is not an address to copy.
      spec.clusterIP === 'None' ? textFact('clusterIP', 'Cluster IP', 'None (headless)') : textFact('clusterIP', 'Cluster IP', spec.clusterIP, { mono: true }),
      // An ExternalName Service is reached by the name it points to; any other by its balancer, else by the external IPs it lists.
      textFact('external', named ? 'External name' : 'External address', named ? spec.externalName : balancer ?? spec.externalIP, { mono: true }),
      textFact('affinity', 'Session affinity', spec.sessionAffinity === 'None' ? undefined : spec.sessionAffinity),
      tagsFact('selector', 'Selector', selectorItems(spec.selector), { wide: true }),
    ),
    conditions: conditionRows(conditions),
    labels: labelModels(metadata.labels),
    annotations: annotationModels(metadata.annotations),
  };
});

/** The commands of a Service's header, as the mock lays them out for the kind (MOCK k8s-resource.js `LAYOUT.Service`; K59): Forward port, Delete, and the menu. Every one of them is offered unavailable (`../detail/commands.ts`). */
export function serviceCommands(): KindCommands {
  return {
    primary: { id: 'forward-port', label: 'Forward port…' },
    danger: { id: 'delete', label: 'Delete' },
    menu: [{ id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
  };
}
