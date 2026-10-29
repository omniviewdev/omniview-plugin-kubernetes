import type { SearchActionReferenceV1, SearchExecutionContextV1, SearchProviderItemV1, SearchScopeV1 } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import React from 'react';

import type { DrawerActionDeps } from '../shared/drawer/actionDeps';
import { useDrawerActionExecution } from '../shared/drawer/DrawerActionsBridge';

import { executeKubernetesAction, resolveKubernetesActions, type KubernetesActionTarget } from './resourceActions';

type ResourceScope = Extract<SearchScopeV1, { kind: 'resource' }>;
type ContextTarget = { connectionID: string; resourceKey: string };
type Resolver = (target: ContextTarget, signal: AbortSignal) => Promise<DrawerActionDeps>;
let resolveContext: Resolver | undefined;
let executionPending = false;
const keyOf = (target: ContextTarget) => JSON.stringify([target.connectionID, target.resourceKey]);
const abortError = () => new DOMException('Kubernetes action request cancelled', 'AbortError');
let discovered: { scope: string; ids: Set<string> } | undefined;

async function freshTarget(scope: ResourceScope, signal: AbortSignal): Promise<KubernetesActionTarget> {
  if (scope.pluginId !== 'kubernetes') throw new Error('Kubernetes action target belongs to another plugin');
  if (signal.aborted) throw abortError();
  const request = ResourceClient.Get('kubernetes', scope.connectionId, scope.resourceKey, {
    id: scope.resourceId, namespace: scope.namespace,
  });
  const cancel = () => { void request.cancel?.(); };
  signal.addEventListener('abort', cancel, { once: true });
  let result;
  try {
    result = await request;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
  if (signal.aborted) throw abortError();
  if (!result?.success || !result.result || typeof result.result !== 'object') {
    throw new Error('Kubernetes resource is no longer available');
  }
  return targetFromData(scope, result.result);
}

function targetFromData(scope: ResourceScope, data: unknown): KubernetesActionTarget {
  if (!data || typeof data !== 'object') throw new Error('Kubernetes resource is no longer available');
  const metadata = (data as KubernetesActionTarget['data']).metadata;
  if (!scope.connectionId || !scope.resourceId || !metadata || metadata.name !== scope.resourceId
    || (metadata.namespace ?? '') !== scope.namespace
    || (scope.uid !== undefined && metadata.uid !== scope.uid)) {
    throw new Error('Kubernetes action target identity no longer matches the resource');
  }
  return {
    pluginID: 'kubernetes', connectionID: scope.connectionId, resourceKey: scope.resourceKey,
    resourceID: scope.resourceId, namespace: scope.namespace, uid: scope.uid,
    data: data as KubernetesActionTarget['data'],
  };
}

async function prepare(scope: ResourceScope, signal: AbortSignal) {
  const resolver = resolveContext;
  if (!resolver) throw new Error('Kubernetes search action context is unavailable');
  const target = await freshTarget(scope, signal);
  const deps = await resolver({ connectionID: scope.connectionId, resourceKey: scope.resourceKey }, signal);
  if (signal.aborted || resolver !== resolveContext) throw abortError();
  return { target, deps };
}

export async function searchActions(scope: ResourceScope, signal: AbortSignal, data?: unknown): Promise<SearchProviderItemV1[]> {
  const resolver = resolveContext;
  if (!resolver) throw new Error('Kubernetes search action context is unavailable');
  const target = data === undefined ? await freshTarget(scope, signal) : targetFromData(scope, data);
  if (resolver !== resolveContext || signal.aborted) throw abortError();
  const items = resolveKubernetesActions(target).flatMap((descriptor) => {
    const choices = descriptor.items ?? (descriptor.execute ? [descriptor] : []);
    return choices.map((choice) => ({
      id: choice.id,
      label: descriptor.items && !(descriptor.execute && descriptor.items.length === 1)
        ? `${descriptor.title}: ${choice.title}` : descriptor.title,
      value: { schemaVersion: 1 as const, kind: 'action' as const, scope, action: { id: choice.id, target: scope } },
    }));
  });
  discovered = { scope: JSON.stringify(scope), ids: new Set(items.map(item => item.id)) };
  return items;
}

export function validateSearchAction(action: SearchActionReferenceV1, context: SearchExecutionContextV1): boolean {
  if (action.target.kind !== 'resource' || action.target.pluginId !== 'kubernetes') return false;
  context.signal.throwIfAborted();
  return Boolean(resolveContext && discovered?.scope === JSON.stringify(action.target) && discovered.ids.has(action.id));
}

export async function executeSearchAction(action: SearchActionReferenceV1, context: SearchExecutionContextV1): Promise<void> {
  if (action.target.kind !== 'resource') throw new Error('Kubernetes action requires a resource target');
  if (executionPending) throw new Error('Finish the current Kubernetes action before starting another');
  executionPending = true;
  try {
    const { target, deps } = await prepare(action.target, context.signal);
    const descriptors = resolveKubernetesActions(target, deps);
    const descriptor = descriptors.find((candidate) => candidate.id === action.id || candidate.items?.some((item) => item.id === action.id));
    if (!descriptor) throw new Error('Kubernetes action is no longer available');
    await executeKubernetesAction(target, deps, descriptor.id, descriptor.items ? action.id : undefined);
  } finally {
    executionPending = false;
  }
}

type Registration = { key: string; deps: DrawerActionDeps; ready: boolean; busy: boolean };

function ActionContext({ target, register }: {
  target: ContextTarget;
  register: (value?: Registration) => void;
}) {
  const { deps, dialogs, isReady, isBusy } = useDrawerActionExecution(target);
  const latest = React.useRef(deps);
  const latestReady = React.useRef(isReady);
  React.useLayoutEffect(() => {
    latest.current = deps;
    latestReady.current = isReady;
  }, [deps, isReady]);
  const stable = React.useMemo<DrawerActionDeps>(() => ({
    show: (...args) => latest.current.show(...args),
    remove: (...args) => latest.current.remove(...args),
    update: (...args) => latest.current.update(...args),
    createLogSession: (...args) => latest.current.createLogSession(...args),
    createExecSession: (...args) => latest.current.createExecSession(...args),
    executeAction: (...args) => latest.current.executeAction(...args),
    startStreamAction: (...args) => latest.current.startStreamAction(...args),
    startDebug: (...args) => latest.current.startDebug(...args),
    openDebugOptions: (...args) => {
      register({ key: keyOf(target), deps: stable, ready: latestReady.current, busy: true });
      latest.current.openDebugOptions(...args);
    },
    closeDrawer: () => latest.current.closeDrawer(),
    openScale: (value) => {
      register({ key: keyOf(target), deps: stable, ready: latestReady.current, busy: true });
      latest.current.openScale(value);
    },
    get nodeShellConfig() { return latest.current.nodeShellConfig; },
  }), [target, register]);
  React.useEffect(() => {
    register({ key: keyOf(target), deps: stable, ready: isReady, busy: Boolean(isBusy) });
    return () => register();
  }, [target, stable, isReady, isBusy, register]);
  return dialogs;
}

/** At most one hook context exists; discovery never mounts action hooks. */
export default function KubernetesSearchActionContext() {
  const [target, setTarget] = React.useState<ContextTarget | null>(null);
  const current = React.useRef<Registration | undefined>(undefined);
  const pending = React.useRef<{ key: string; finish: (deps?: DrawerActionDeps) => void } | undefined>(undefined);
  const register = React.useCallback((value?: Registration) => {
    current.current = value;
    if (value?.ready && pending.current?.key === value.key) {
      const finish = pending.current.finish;
      pending.current = undefined;
      finish(value.deps);
    }
  }, []);
  React.useEffect(() => {
    const resolver: Resolver = (next, signal) => {
      if (signal.aborted) return Promise.reject(abortError());
      if (pending.current || current.current?.busy) {
        return Promise.reject(new Error('Finish the current Kubernetes action before starting another'));
      }
      const key = keyOf(next);
      if (current.current?.key === key && current.current.ready) return Promise.resolve(current.current.deps);
      return new Promise<DrawerActionDeps>((resolve, reject) => {
        const finish = (deps?: DrawerActionDeps) => {
          signal.removeEventListener('abort', abort);
          if (deps) resolve(deps);
          else reject(new Error('Kubernetes search action context was removed'));
        };
        const abort = () => {
          pending.current = undefined;
          signal.removeEventListener('abort', abort);
          reject(abortError());
        };
        pending.current = { key, finish };
        signal.addEventListener('abort', abort, { once: true });
        setTarget(next);
      });
    };
    resolveContext = resolver;
    return () => {
      if (resolveContext === resolver) resolveContext = undefined;
      discovered = undefined;
      pending.current?.finish();
      pending.current = undefined;
      current.current = undefined;
    };
  }, []);
  return target ? <ActionContext key={keyOf(target)} target={target} register={register} /> : null;
}
