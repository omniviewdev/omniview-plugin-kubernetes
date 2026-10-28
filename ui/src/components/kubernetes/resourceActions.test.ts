import { describe, expect, it, vi } from 'vitest';
import type { DrawerActionDeps } from '../shared/drawer/actionDeps';
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
