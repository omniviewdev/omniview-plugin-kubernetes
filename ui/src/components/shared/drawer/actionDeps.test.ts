import type { DrawerContext } from '@omniviewdev/runtime';
import { describe, expect, it, vi } from 'vitest';

import { resourceDrawerActions } from '../../kubernetes/drawerActions';

import {
  bindDrawerActionDeps,
  type DrawerActionDeps,
  drawerActionDeps,
  drawerActionDepsStore,
  registerDrawerActionDeps,
  registryKey,
} from './actionDeps';

function fakeDeps(): DrawerActionDeps {
  return {
    show: vi.fn(),
    mutate: vi.fn().mockResolvedValue(undefined),
    createLogSession: vi.fn().mockResolvedValue(undefined),
    createExecSession: vi.fn().mockResolvedValue(undefined),
    nativeExecAvailable: false,
    nativeExecPending: false,
    openNativeSession: vi.fn().mockResolvedValue(false),
    executeAction: vi.fn().mockResolvedValue(undefined),
    startResourceAction: vi.fn().mockResolvedValue(undefined),
    closeDrawer: vi.fn(),
    openScale: vi.fn(),
  } as unknown as DrawerActionDeps;
}

const rsCtx: DrawerContext = {
  data: { metadata: { name: 'web-7d4b9c', namespace: 'prod' } },
  resource: {
    pluginID: 'kubernetes',
    route: { connection: 'conn-1' },
    reference: {
      address: {
        provider: 'kubernetes',
        authority: 'test-cluster',
        type: 'k8s:apps/replicasets',
        scope: [{ dimension: 'namespace', value: 'prod' }],
        id: 'web-7d4b9c',
      },
      incarnation: 'native-uid',
    },
    representation: 'native-json-test',
    targetId: 'table-membership',
  },
};

describe('drawerActionDeps', () => {
  it('keeps explicitly bound context handlers independent of mounted surfaces', () => {
    const bound = fakeDeps();
    const mounted = fakeDeps();
    const ctx = bindDrawerActionDeps({ ...rsCtx }, bound);
    const unregister = registerDrawerActionDeps(
      registryKey('conn-1', 'k8s:apps/replicasets'),
      mounted,
    );
    expect(drawerActionDeps(ctx)).toBe(bound);
    unregister();
    expect(drawerActionDeps(ctx)).toBe(bound);
  });

  it('returns the most recently mounted handlers and falls back on unmount', () => {
    const key = registryKey('conn-1', 'k8s:apps/replicasets');
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
    const unregister = registerDrawerActionDeps(
      registryKey('conn-2', 'k8s:apps/replicasets'),
      fakeDeps(),
    );
    expect(() => drawerActionDeps(rsCtx)).toThrow();
    unregister();
  });

  it('publishes registration, replacement, fallback, and removal without retaining cleaned-up listeners', () => {
    const key = registryKey('conn-1', 'k8s:apps/replicasets');
    expect(drawerActionDepsStore.getSnapshot(rsCtx)).toBeUndefined();
    expect(drawerActionDepsStore.getSnapshot(rsCtx)).toBeUndefined();
    const snapshots: Array<DrawerActionDeps | undefined> = [];
    const unsubscribe = drawerActionDepsStore.subscribe(rsCtx, () =>
      snapshots.push(drawerActionDepsStore.getSnapshot(rsCtx)),
    );
    const table = fakeDeps();
    const drawer = { ...fakeDeps(), nativeExecAvailable: true };
    const unregisterTable = registerDrawerActionDeps(key, table);
    const unregisterDrawer = registerDrawerActionDeps(key, drawer);
    expect(drawerActionDepsStore.getSnapshot(rsCtx)).toBe(drawer);
    unregisterDrawer();
    unregisterTable();
    expect(snapshots).toEqual([table, drawer, table, undefined]);
    unsubscribe();
    const unregisterLater = registerDrawerActionDeps(key, fakeDeps());
    unregisterLater();
    expect(snapshots).toHaveLength(4);
  });
});

describe('resourceDrawerActions', () => {
  it('keeps the drawer open until the host adopts the restart', async () => {
    const adoption = Promise.withResolvers<void>();
    const deps = fakeDeps();
    vi.mocked(deps.startResourceAction).mockImplementation(async () => {
      await adoption.promise;
      return {
        id: 'accepted',
        revision: 1,
        kind: 'task',
        severity: 'info',
        source: {},
        presentation: { title: 'Restart' },
        task: { state: 'starting', cancellation: 'unsupported' },
        visibility: { collapsed: false, read: false, toastDismissed: false },
        createdAt: '2026-11-03T00:00:00Z',
        updatedAt: '2026-11-03T00:00:00Z',
      };
    });
    const ctx = bindDrawerActionDeps(
      {
        ...rsCtx,
        resource: {
          ...rsCtx.resource!,
          reference: {
            ...rsCtx.resource!.reference,
            address: { ...rsCtx.resource!.reference.address, type: 'k8s:apps/deployments' },
          },
        },
      },
      deps,
    );
    const restart = resourceDrawerActions['k8s:apps/deployments'].actions.find(
      (action) => action.title === 'Restart',
    )!;
    restart.action!(ctx);
    const { onConfirm } = vi.mocked(deps.show).mock.calls[0][0] as {
      onConfirm: () => Promise<void>;
    };
    const pending = onConfirm();
    expect(deps.closeDrawer).not.toHaveBeenCalled();
    adoption.resolve();
    await pending;
    expect(deps.closeDrawer).toHaveBeenCalledOnce();
  });

  it('keeps the drawer open when restart adoption fails', async () => {
    const deps = fakeDeps();
    const failure = new Error('Host admission failed');
    vi.mocked(deps.startResourceAction).mockRejectedValue(failure);
    const ctx = bindDrawerActionDeps(
      {
        ...rsCtx,
        resource: {
          ...rsCtx.resource!,
          reference: {
            ...rsCtx.resource!.reference,
            address: { ...rsCtx.resource!.reference.address, type: 'k8s:apps/deployments' },
          },
        },
      },
      deps,
    );
    const restart = resourceDrawerActions['k8s:apps/deployments'].actions.find(
      (action) => action.title === 'Restart',
    )!;
    restart.action!(ctx);
    const { onConfirm } = vi.mocked(deps.show).mock.calls[0][0] as {
      onConfirm: () => Promise<void>;
    };
    await expect(onConfirm()).rejects.toBe(failure);
    expect(deps.closeDrawer).not.toHaveBeenCalled();
  });
});
