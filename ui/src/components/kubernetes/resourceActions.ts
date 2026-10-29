import type { DrawerContext, DrawerComponentAction } from '@omniviewdev/runtime';

import { bindDrawerActionDeps, type DrawerActionDeps } from '../shared/drawer/actionDeps';
import { resourceDrawerActions } from './drawerActions';

export type KubernetesActionTarget = {
  pluginID: 'kubernetes';
  connectionID: string;
  resourceKey: string;
  resourceID: string;
  namespace: string;
  uid?: string;
  data: Record<string, unknown> & {
    metadata?: { name?: string; namespace?: string; uid?: string };
  };
};

const actionID = (key: string, title: string) => `kubernetes:${key}:${encodeURIComponent(title)}`;

/** Resolve only existing actions, against exact object identity and fresh data. */
export function resolveKubernetesActions(target: KubernetesActionTarget, deps?: DrawerActionDeps) {
  const metadata = target.data.metadata;
  if (target.pluginID !== 'kubernetes' || !target.connectionID || !target.resourceID
    || !metadata || metadata.name !== target.resourceID || (metadata.namespace ?? '') !== target.namespace
    || (target.uid !== undefined && metadata.uid !== target.uid)) {
    throw new Error('Kubernetes action target identity no longer matches the resource');
  }
  const ctx: DrawerContext = {
    data: target.data,
    resource: {
      pluginID: target.pluginID,
      connectionID: target.connectionID,
      key: target.resourceKey,
      id: target.resourceID,
    },
  };
  if (deps) bindDrawerActionDeps(ctx, deps);
  return (resourceDrawerActions[target.resourceKey]?.actions ?? []).flatMap((descriptor: DrawerComponentAction) => {
    if (typeof descriptor.title !== 'string'
      || (typeof descriptor.enabled === 'function' ? !descriptor.enabled(ctx) : descriptor.enabled === false)) return [];
    const id = actionID(target.resourceKey, descriptor.title);
    const items = typeof descriptor.list === 'function' ? descriptor.list(ctx) : descriptor.list;
    return [{
      id,
      title: descriptor.title,
      icon: descriptor.icon,
      execute: descriptor.action ? () => descriptor.action!(ctx) : undefined,
      // Container names, not row indices, keep choices stable when lists reorder.
      items: descriptor.action && items?.length === 1 ? undefined : items?.flatMap((item) => typeof item.title !== 'string' ? [] : [{
        id: `${id}:${encodeURIComponent(item.title)}`,
        title: item.title,
        icon: item.icon,
        execute: () => item.action(ctx),
      }]),
    }];
  });
}

export function executeKubernetesAction(
  target: KubernetesActionTarget,
  deps: DrawerActionDeps,
  id: string,
  itemID?: string,
) {
  const action = resolveKubernetesActions(target, deps).find((candidate) => candidate.id === id);
  if (!action) throw new Error('Kubernetes action is no longer available');
  if (action.items) {
    const item = action.items.find((candidate) => candidate.id === itemID);
    if (!item) throw new Error('Choose an available Kubernetes action target');
    return item.execute();
  }
  if (itemID || !action.execute) throw new Error('Kubernetes action is not executable');
  return action.execute();
}
