import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, flag, isObject, metadataOf, objects, text, type ObjectMeta } from '../object';

// The part of a Node that the list reads: its conditions (the Ready one), whether it is cordoned, its addresses and its kubelet version. Anything the object does not hold is absent here, and stays
// absent downstream (`../object.ts`).

export type NodeCondition = {
  readonly type?: string;
  readonly status?: string;
};

export type NodeAddress = {
  readonly type?: string;
  readonly address?: string;
};

export type NodeObject = {
  readonly metadata?: ObjectMeta;
  readonly spec?: { readonly unschedulable?: boolean };
  readonly status?: {
    readonly conditions?: readonly NodeCondition[];
    readonly addresses?: readonly NodeAddress[];
    readonly kubeletVersion?: string;
  };
};

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toNode(value: unknown): NodeObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec, status } = value;
  return {
    metadata: metadataOf(metadata),
    spec: isObject(spec) ? { unschedulable: flag(spec.unschedulable) } : undefined,
    status: isObject(status)
      ? {
        conditions: objects(status.conditions)?.map((condition) => ({ type: text(condition.type), status: text(condition.status) })),
        addresses: objects(status.addresses)?.map((address) => ({ type: text(address.type), address: text(address.address) })),
        kubeletVersion: isObject(status.nodeInfo) ? text(status.nodeInfo.kubeletVersion) : undefined,
      }
      : undefined,
  };
}

/** The Node a record holds. A body that is not a Node gives an empty one, never an error: one odd object must not take the list down. */
export function nodeObject(host: HostRecord): NodeObject {
  return toNode(bodyOf(host));
}
