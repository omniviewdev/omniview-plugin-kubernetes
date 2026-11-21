import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import type { KindCommands } from '../definition';
import { conditionRows, type ConditionInput } from '../detail/conditions';
import { annotationModels, labelModels } from '../detail/metadata';
import { conditionInputs, detailMeta, type DetailMeta } from '../detail/object';
import { facts, overviewModel, textFact, type KindOverview } from '../detail/overview';
import { bodyOf, flag, isObject, objects, text, type Json } from '../object';

import { nodeRow } from './row';

// The page of one Node: what it says of the object a record holds, from the mock's `OVERVIEW.Node` (MOCK k8s-resource-definitions.js; K59). The values are the API's (decision A19) and the words are the
// mock's. The header's word is the list's (`nodeRow`), so the page and the row never disagree. The mock's `14 Pods · 62% CPU requested` needs the Pods on the Node, which the page has no read for: there
// is no summary.

/** The part of a Node that its page reads, beyond what its list reads (`./object.ts`). */
export type NodeDetail = {
  readonly metadata: DetailMeta;
  readonly unschedulable?: boolean | undefined;
  readonly info: {
    readonly kubeletVersion?: string | undefined;
    readonly osImage?: string | undefined;
    readonly containerRuntimeVersion?: string | undefined;
    readonly kernelVersion?: string | undefined;
  };
  /** The address of `status.addresses` of type InternalIP. */
  readonly internalIP?: string | undefined;
  /** Undefined when the object holds no list of conditions. */
  readonly conditions?: readonly ConditionInput[] | undefined;
};

const NOTHING: Json = {};

/** What the page reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
export function nodeDetail(host: HostRecord): NodeDetail {
  const body = bodyOf(host);
  const { metadata, spec, status } = isObject(body) ? body : NOTHING;
  const state = isObject(status) ? status : NOTHING;
  const info = isObject(state.nodeInfo) ? state.nodeInfo : NOTHING;
  return {
    metadata: detailMeta(metadata),
    unschedulable: isObject(spec) ? flag(spec.unschedulable) : undefined,
    info: {
      kubeletVersion: text(info.kubeletVersion),
      osImage: text(info.osImage),
      containerRuntimeVersion: text(info.containerRuntimeVersion),
      kernelVersion: text(info.kernelVersion),
    },
    internalIP: objects(state.addresses)?.flatMap((address) => (address.type === 'InternalIP' ? (text(address.address) ?? []) : []))[0],
    conditions: conditionInputs(state.conditions),
  };
}

const ROLE_PREFIX = 'node-role.kubernetes.io/';
const ZONE = 'topology.kubernetes.io/zone';
const INSTANCE_TYPE = 'node.kubernetes.io/instance-type';

/** What kubectl prints as `Roles:`: the part after the prefix of every label that has it, in the object's order. A Node with none says none. */
function rolesOf(labels: Readonly<Record<string, string>>): string | undefined {
  const roles = Object.keys(labels).filter((key) => key.startsWith(ROLE_PREFIX) && key.length > ROLE_PREFIX.length).map((key) => key.slice(ROLE_PREFIX.length));
  return roles.length === 0 ? undefined : roles.join(', ');
}

export const nodeOverview = overviewModel((host): KindOverview => {
  const row = nodeRow(host);
  const { metadata, info, internalIP, conditions } = nodeDetail(host);
  return {
    state: row.status,
    createdAt: row.createdAt,
    summary: [],
    details: facts(
      textFact('kubelet', 'Kubelet version', info.kubeletVersion),
      textFact('os', 'OS image', info.osImage),
      textFact('runtime', 'Container runtime', info.containerRuntimeVersion),
      textFact('ip', 'Internal IP', internalIP, { mono: true }),
      textFact('roles', 'Roles', rolesOf(metadata.labels)),
      textFact('kernel', 'Kernel version', info.kernelVersion),
      textFact('zone', 'Zone', metadata.labels[ZONE]),
      textFact('instance', 'Instance type', metadata.labels[INSTANCE_TYPE]),
    ),
    conditions: conditionRows(conditions),
    labels: labelModels(metadata.labels),
    annotations: annotationModels(metadata.annotations),
  };
});

/**
 * The commands of a Node's header, as the mock lays them out for the kind (MOCK k8s-resource.js `LAYOUT.Node`; K59): Cordon, Drain and Node shell, Delete, and the menu. Every one of them is offered
 * unavailable (`../detail/commands.ts`). The primary says what it would do: Cordon, or Uncordon while the Node is cordoned (`spec.unschedulable`).
 */
export function nodeCommands(host: HostRecord): KindCommands {
  const cordoned = nodeDetail(host).unschedulable === true;
  return {
    primary: cordoned ? { id: 'uncordon', label: 'Uncordon' } : { id: 'cordon', label: 'Cordon' },
    secondary: [{ id: 'drain', label: 'Drain…' }, { id: 'node-shell', label: 'Node shell' }],
    danger: { id: 'delete', label: 'Delete' },
    menu: [
      { id: 'taint-add', label: 'Add taint…' },
      { id: 'taint-remove', label: 'Remove taint…' },
      { id: 'events', label: 'Events' },
      { id: 'copy-name', label: 'Copy name' },
    ],
  };
}
