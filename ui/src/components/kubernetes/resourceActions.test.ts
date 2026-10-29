import type { DrawerContext } from '@omniviewdev/runtime';
import { describe, expect, it, vi } from 'vitest';

import type { DrawerActionDeps } from '../shared/drawer/actionDeps';
import { bindDrawerActionDeps } from '../shared/drawer/actionDeps';

import { resourceDrawerActions } from './drawerActions';
import { executeKubernetesAction, resolveKubernetesActions, type KubernetesActionTarget } from './resourceActions';

const target = (resourceKey = 'core::v1::Pod'): KubernetesActionTarget => ({
  pluginID: 'kubernetes', connectionID: 'prod', resourceKey,
  resourceID: 'api', namespace: 'apps', uid: 'uid-1',
  data: {
    metadata: { name: 'api', namespace: 'apps', uid: 'uid-1' },
    spec: {
      containers: [{ name: 'main' }], initContainers: [{ name: 'setup' }],
      ephemeralContainers: [{ name: 'debug' }],
      template: { spec: { containers: [{ name: 'main' }, { name: 'sidecar' }] } },
      jobTemplate: { spec: { template: { spec: { containers: [{ name: 'main' }, { name: 'sidecar' }] } } } },
    },
  },
});
const deps = () => ({
  createLogSession: vi.fn().mockResolvedValue({ id: 'session' }),
  closeDrawer: vi.fn(), show: vi.fn(),
} as unknown as DrawerActionDeps);

describe('standalone Kubernetes actions', () => {
  it('opens init and ephemeral logs without mounted handlers and keeps exact identity', async () => {
    const handlers = deps();
    const object = target();
    const logs = resolveKubernetesActions(object, handlers).find((action) => action.title === 'Logs')!;
    expect(logs.items?.map((item) => item.title)).toEqual(['All Containers', 'main', 'setup (init)', 'debug (ephemeral)']);
    await executeKubernetesAction(object, handlers, logs.id, logs.items![2].id);
    expect(handlers.createLogSession).toHaveBeenCalledWith(expect.objectContaining({
      connectionID: 'prod', resourceKey: 'core::v1::Pod', resourceID: 'api',
      resourceData: object.data, target: 'setup', params: { filter_labels: 'container' },
    }));
    expect(handlers.closeDrawer).toHaveBeenCalledOnce();
  });

  it.each(['Deployment', 'DaemonSet', 'ReplicaSet', 'StatefulSet', 'Job', 'CronJob'])(
    'keeps all-container and named-container logs for %s', (kind) => {
      const group = ['Job', 'CronJob'].includes(kind) ? 'batch' : 'apps';
      const object = target(`${group}::v1::${kind}`);
      const logs = resolveKubernetesActions(object, deps()).find((action) => action.title === 'Logs')!;
      expect(logs.items?.map((item) => item.title)).toEqual(['All Containers', 'main', 'sidecar']);
    },
  );

  it('requires explicit container selection and rejects stale choices', () => {
    const handlers = deps();
    const object = target();
    const logs = resolveKubernetesActions(object, handlers).find((action) => action.title === 'Logs')!;
    expect(() => executeKubernetesAction(object, handlers, logs.id)).toThrow(/Choose/);
    expect(() => executeKubernetesAction(object, handlers, logs.id, 'missing')).toThrow(/Choose/);
    expect(handlers.createLogSession).not.toHaveBeenCalled();
  });

  it('rejects stale UID, namespace mismatch, and unavailable actions', () => {
    const object = target();
    expect(() => resolveKubernetesActions({ ...object, uid: 'deleted' }, deps())).toThrow(/identity/);
    expect(() => resolveKubernetesActions({ ...object, namespace: 'other' }, deps())).toThrow(/identity/);
    expect(() => executeKubernetesAction(object, deps(), 'missing')).toThrow(/no longer available/);
    expect(resolveKubernetesActions(object, deps()).some((action) => action.title === 'Resize')).toBe(false);
  });

  it('preserves confirmation and propagates rejected delete without closing drawer', async () => {
    const handlers = { ...deps(), remove: vi.fn().mockRejectedValue(new Error('Forbidden')) };
    const object = target();
    const action = resolveKubernetesActions(object, handlers).find((entry) => entry.title === 'Delete')!;
    executeKubernetesAction(object, handlers, action.id);
    expect(handlers.remove).not.toHaveBeenCalled();
    const confirmation = vi.mocked(handlers.show).mock.calls[0][0] as { onConfirm: () => Promise<void> };
    await expect(confirmation.onConfirm()).rejects.toThrow('Forbidden');
    expect(handlers.closeDrawer).not.toHaveBeenCalled();
  });
});

type DebugPodTarget = KubernetesActionTarget & {
  data: {
    metadata: { name: string; namespace: string; uid: string; annotations?: Record<string, string>; deletionTimestamp?: string };
    spec: { containers: { name: string }[]; initContainers: { name: string }[]; ephemeralContainers: { name: string }[] };
    status: {
      phase: string;
      containerStatuses: { name: string; state: Record<string, unknown> }[];
      initContainerStatuses: { name: string; state: Record<string, unknown> }[];
      ephemeralContainerStatuses: { name: string; state: Record<string, unknown> }[];
    };
  };
};

const livePod = (): DebugPodTarget => ({
  ...target(),
  data: {
    metadata: { name: 'api', namespace: 'apps', uid: 'uid-1' },
    spec: {
      containers: [{ name: 'worker' }, { name: 'main' }, { name: 'stopped' }],
      initContainers: [{ name: 'setup' }],
      ephemeralContainers: [{ name: 'old-debugger' }],
    },
    status: {
      phase: 'Running',
      containerStatuses: [
        { name: 'main', state: { running: {} } },
        { name: 'worker', state: { running: {} } },
        { name: 'stopped', state: { terminated: { exitCode: 1 } } },
      ],
      initContainerStatuses: [{ name: 'setup', state: { running: {} } }],
      ephemeralContainerStatuses: [{ name: 'old-debugger', state: { running: {} } }],
    },
  },
});

describe('live Pod Debug actions', () => {
  const debugDeps = () => ({ ...deps(), startDebug: vi.fn().mockResolvedValue(undefined) });
  const debugAction = (object: KubernetesActionTarget, handlers = debugDeps()) =>
    resolveKubernetesActions(object, handlers).find(action => action.title === 'Debug');

  it('offers only exact running regular container names, never bulk, init, stopped, or ephemeral targets', () => {
    const debug = debugAction(livePod());
    expect(debug).toBeDefined();
    expect(debug!.items?.map(item => item.title).sort()).toEqual(['main', 'worker']);
  });

  it('launches one running target directly without routine confirmation', async () => {
    const handlers = debugDeps();
    const object = livePod();
    object.data.status.containerStatuses[0].state = { waiting: { reason: 'CrashLoopBackOff' } };
    const debug = debugAction(object, handlers);
    expect(debug).toBeDefined();
    await executeKubernetesAction(object, handlers, debug!.id);
    expect(handlers.startDebug).toHaveBeenCalledTimes(1);
    expect(handlers.startDebug).toHaveBeenCalledWith({
      connectionID: 'prod', resourceID: 'api', namespace: 'apps', podUID: 'uid-1',
      targetContainerName: 'worker', resourceData: object.data,
    });
    expect(handlers.show).not.toHaveBeenCalled();
  });

  it('requires a named choice for multiple targets and revalidates a stopped choice', async () => {
    const handlers = debugDeps();
    const object = livePod();
    const debug = debugAction(object, handlers)!;
    expect(debug).toBeDefined();
    expect(() => executeKubernetesAction(object, handlers, debug.id)).toThrow(/Choose/);
    const main = debug.items!.find(item => item.title === 'main')!;
    object.data.status.containerStatuses[0].state = { terminated: { exitCode: 0 } };
    expect(() => executeKubernetesAction(object, handlers, debug.id, main.id)).toThrow(/available|executable|Choose/);
    expect(handlers.startDebug).not.toHaveBeenCalled();
  });

  it('keeps named selection stable when fresh container order changes', async () => {
    const handlers = debugDeps();
    const object = livePod();
    const debug = debugAction(object, handlers)!;
    expect(debug).toBeDefined();
    const main = debug.items!.find(item => item.title === 'main')!;
    object.data.spec.containers.reverse();
    await executeKubernetesAction(object, handlers, debug.id, main.id);
    expect(handlers.startDebug).toHaveBeenCalledWith(expect.objectContaining({ targetContainerName: 'main' }));
  });

  it.each(['two-to-one', 'one-to-two'])('preserves a selected running target across %s resolution', async (change) => {
    const handlers = debugDeps();
    const object = livePod();
    if (change === 'one-to-two') {
      object.data.status.containerStatuses[1].state = { waiting: {} };
    }
    const debug = debugAction(object, handlers)!;
    const main = debug.items?.find(item => item.title === 'main');
    expect(main).toBeDefined();
    object.data.status.containerStatuses[1].state = change === 'two-to-one'
      ? { terminated: { exitCode: 0 } }
      : { running: {} };
    await executeKubernetesAction(object, handlers, debug.id, main!.id);
    expect(handlers.startDebug).toHaveBeenCalledTimes(1);
    expect(handlers.startDebug).toHaveBeenCalledWith(expect.objectContaining({
      targetContainerName: 'main', resourceData: object.data,
    }));
  });

  it.each(['no-running', 'static', 'deleting', 'Succeeded', 'Failed'])('does not offer Debug for %s Pods', (condition) => {
    const object = livePod();
    if (condition === 'no-running') object.data.status.containerStatuses = [];
    else if (condition === 'static') object.data.metadata.annotations = { 'kubernetes.io/config.mirror': 'mirror' };
    else if (condition === 'deleting') object.data.metadata.deletionTimestamp = '2026-10-28T00:00:00Z';
    else object.data.status.phase = condition;
    expect(debugAction(object)).toBeUndefined();
  });

  it('rejects replaced Pod identities before invoking the launch hook', () => {
    const handlers = debugDeps();
    const object = livePod();
    const debug = debugAction(object, handlers)!;
    expect(debug).toBeDefined();
    object.data.metadata!.uid = 'replacement';
    expect(() => executeKubernetesAction(object, handlers, debug.id, debug.items![0].id)).toThrow(/identity/);
    expect(handlers.startDebug).not.toHaveBeenCalled();
  });

  it('launches the single running target from the header without confirmation', async () => {
    const handlers = debugDeps();
    const object = livePod();
    object.data.status.containerStatuses[1].state = { terminated: { exitCode: 0 } };
    const ctx = bindDrawerActionDeps({
      data: object.data,
      resource: { pluginID: 'kubernetes', connectionID: 'prod', key: object.resourceKey, id: 'api' },
    } as DrawerContext, handlers);
    const header = resourceDrawerActions[object.resourceKey].actions!.find(action => action.title === 'Debug');
    expect(header).toBeDefined();
    await header!.action!(ctx);
    expect(handlers.startDebug).toHaveBeenCalledTimes(1);
    expect(handlers.show).not.toHaveBeenCalled();
    expect(handlers.startDebug).toHaveBeenCalledWith(expect.objectContaining({
      podUID: 'uid-1', targetContainerName: 'main', resourceData: object.data,
    }));
  });
});
