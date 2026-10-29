import type {
  DrawerContext,
  useConfirmationModal,
  useExec,
  useExecuteAction,
  useLogs,
  useResourceMutations,
  useStreamAction,
} from '@omniviewdev/runtime';
import type { Pod } from 'kubernetes-types/core/v1';

/**
 * Shared hook-backed execution dependencies. Drawer bridges register fallback
 * handlers; standalone consumers bind handlers directly to their context.
 * Context binding survives confirmation callbacks without a mounted table.
 */

export type ScaleTarget = { name: string; namespace: string; replicas: number };

type NodeShellConfig = { image?: string; command?: string };

export type StartDebugInput = {
  connectionID: string;
  resourceID: string;
  namespace: string;
  podUID: string;
  targetContainerName: string;
  resourceData: Pod;
};

export type DrawerActionDeps = {
  show: ReturnType<typeof useConfirmationModal>['show'];
  remove: ReturnType<typeof useResourceMutations>['remove'];
  update: ReturnType<typeof useResourceMutations>['update'];
  createLogSession: ReturnType<typeof useLogs>['createLogSession'];
  createExecSession: ReturnType<typeof useExec>['createSession'];
  executeAction: ReturnType<typeof useExecuteAction>['executeAction'];
  startStreamAction: ReturnType<typeof useStreamAction>['startStreamAction'];
  closeDrawer: () => void;
  /** Opens the replica count dialog; confirming runs the `scale` action. */
  openScale: (target: ScaleTarget) => void;
  startDebug: (input: StartDebugInput) => Promise<void>;
  openDebugOptions: (input: StartDebugInput) => void;
  nodeShellConfig?: NodeShellConfig;
};

const registry = new Map<string, DrawerActionDeps[]>();

const contextDeps = new WeakMap<DrawerContext, DrawerActionDeps>();

export function bindDrawerActionDeps(ctx: DrawerContext, deps: DrawerActionDeps): DrawerContext {
  contextDeps.set(ctx, deps);
  return ctx;
}

export const registryKey = (connectionID: string, resourceKey: string) => `${connectionID}\u0000${resourceKey}`;

export function registerDrawerActionDeps(key: string, deps: DrawerActionDeps): () => void {
  const list = registry.get(key) ?? [];
  list.push(deps);
  registry.set(key, list);
  return () => {
    const current = registry.get(key);
    if (!current) return;
    const idx = current.lastIndexOf(deps);
    if (idx !== -1) current.splice(idx, 1);
    if (current.length === 0) registry.delete(key);
  };
}

/** The hook-backed handlers for the resource in `ctx`. Call it inside an action handler. */
export function drawerActionDeps(ctx: DrawerContext): DrawerActionDeps {
  const bound = contextDeps.get(ctx);
  if (bound) return bound;
  const connectionID = ctx.resource?.connectionID ?? '';
  const resourceKey = ctx.resource?.key ?? '';
  const list = registry.get(registryKey(connectionID, resourceKey));
  const deps = list?.[list.length - 1];
  if (!deps) {
    throw new Error(`No drawer action handlers are mounted for ${resourceKey} on connection ${connectionID}`);
  }
  return deps;
}
