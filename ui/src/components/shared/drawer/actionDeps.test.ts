import type { DrawerContext } from '@omniviewdev/runtime';
import { describe, expect, it, vi } from 'vitest';

import { resourceDrawerActions } from '../../kubernetes/drawerActions';

import { bindDrawerActionDeps, type DrawerActionDeps, drawerActionDeps, registerDrawerActionDeps, registryKey } from './actionDeps';

function fakeDeps(): DrawerActionDeps {
  return {
    show: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    createLogSession: vi.fn().mockResolvedValue(undefined),
    createExecSession: vi.fn().mockResolvedValue(undefined),
    executeAction: vi.fn().mockResolvedValue(undefined),
    startStreamAction: vi.fn().mockResolvedValue(undefined),
    closeDrawer: vi.fn(),
    openScale: vi.fn(),
  } as unknown as DrawerActionDeps;
}

const rsCtx: DrawerContext = {
  data: { metadata: { name: 'web-7d4b9c', namespace: 'prod' } },
  resource: { id: 'web-7d4b9c', key: 'apps::v1::ReplicaSet', connectionID: 'conn-1', pluginID: 'kubernetes' },
};

describe('drawerActionDeps', () => {
  it('keeps explicitly bound context handlers independent of mounted surfaces', () => {
    const bound = fakeDeps();
    const mounted = fakeDeps();
    const ctx = bindDrawerActionDeps({ ...rsCtx }, bound);
    const unregister = registerDrawerActionDeps(registryKey('conn-1', 'apps::v1::ReplicaSet'), mounted);
    expect(drawerActionDeps(ctx)).toBe(bound);
    unregister();
    expect(drawerActionDeps(ctx)).toBe(bound);
  });

  it('throws when nothing is mounted for the resource', () => {
    expect(() => drawerActionDeps(rsCtx)).toThrow(/apps::v1::ReplicaSet/);
  });

  it('returns the most recently mounted handlers and falls back on unmount', () => {
    const key = registryKey('conn-1', 'apps::v1::ReplicaSet');
    const table = fakeDeps();
    const drawer = fakeDeps();
    const unregisterTable = registerDrawerActionDeps(key, table);
    const unregisterDrawer = registerDrawerActionDeps(key, drawer);

    expect(drawerActionDeps(rsCtx)).toBe(drawer);
    unregisterDrawer();
    expect(drawerActionDeps(rsCtx)).toBe(table);
    unregisterTable();
    expect(() => drawerActionDeps(rsCtx)).toThrow();
  });

  it('does not mix up connections', () => {
    const unregister = registerDrawerActionDeps(registryKey('conn-2', 'apps::v1::ReplicaSet'), fakeDeps());
    expect(() => drawerActionDeps(rsCtx)).toThrow();
    unregister();
  });
});

describe('resourceDrawerActions', () => {
  it('gives linked ReplicaSet and Deployment drawers their actions', () => {
    const titles = (key: string) => resourceDrawerActions[key]?.actions.map((a) => a.title);
    expect(titles('apps::v1::ReplicaSet')).toEqual(['Delete', 'Logs']);
    expect(titles('apps::v1::Deployment')).toEqual([
      'Restart', 'Scale', 'Pause Rollout', 'Resume Rollout', 'Delete', 'Logs',
    ]);
    expect(resourceDrawerActions['apps::v1::Deployment'].editorSubmit).toBeTypeOf('function');
  });

  it('runs a linked delete through the mounted handlers', async () => {
    const deps = fakeDeps();
    const unregister = registerDrawerActionDeps(registryKey('conn-1', 'apps::v1::ReplicaSet'), deps);

    const del = resourceDrawerActions['apps::v1::ReplicaSet'].actions.find((a) => a.title === 'Delete');
    del?.action?.(rsCtx);
    expect(deps.show).toHaveBeenCalledTimes(1);

    const { onConfirm } = vi.mocked(deps.show).mock.calls[0][0] as { onConfirm: () => Promise<void> };
    await onConfirm();
    expect(deps.remove).toHaveBeenCalledWith({
      opts: { connectionID: 'conn-1', resourceKey: 'apps::v1::ReplicaSet', resourceID: 'web-7d4b9c', namespace: 'prod' },
      input: {},
    });
    expect(deps.closeDrawer).toHaveBeenCalled();
    unregister();
  });
});
