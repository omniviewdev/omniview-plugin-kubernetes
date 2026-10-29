import type { SearchExecutionContextV1, SearchProviderItemV1, SearchScopeV1 } from '@omniviewdev/runtime';
import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  hook: vi.fn(),
  revision: 0,
  listeners: new Set<() => void>(),
  deps: {
    createLogSession: vi.fn().mockResolvedValue({ id: 'session' }), closeDrawer: vi.fn(),
    startDebug: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@omniviewdev/runtime/api', () => ({ ResourceClient: { Get: mocks.get } }));
vi.mock('../shared/drawer/DrawerActionsBridge', () => {
  const subscribe = (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => { mocks.listeners.delete(listener); };
  };
  return {
    useDrawerActionExecution: (target: unknown) => {
      React.useSyncExternalStore(subscribe, () => mocks.revision);
      return mocks.hook(target)
        ?? { deps: mocks.deps, dialogs: null, isBusy: false, isReady: true };
    },
  };
});

import type { StartDebugInput } from '../shared/drawer/actionDeps';

import KubernetesSearchActionContext, { executeSearchAction, searchActions, validateSearchAction } from './KubernetesSearchActionContext';

const scope: Extract<SearchScopeV1, { kind: 'resource' }> = {
  kind: 'resource', pluginId: 'kubernetes', connectionId: 'prod', resourceKey: 'core::v1::Pod',
  resourceId: 'api', namespace: 'apps', uid: 'original', label: 'api',
};
const data = {
  metadata: { name: 'api', namespace: 'apps', uid: 'original' },
  spec: { containers: [{ name: 'main' }] },
};
const context = (): SearchExecutionContextV1 => ({ signal: new AbortController().signal, generation: 1, openResource: vi.fn() });

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue({ success: true, result: data });
  mocks.hook.mockReset();
  mocks.deps.createLogSession.mockClear();
  mocks.deps.closeDrawer.mockClear();
  mocks.deps.startDebug.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

function mockDrawerState(value: unknown) {
  act(() => {
    mocks.hook.mockReturnValue(value);
    mocks.revision += 1;
    for (const listener of mocks.listeners) listener();
  });
}

describe('global Kubernetes action context', () => {
  it('discovers and dispatches logs without a mounted table or plugin page', async () => {
    render(<KubernetesSearchActionContext />);
    const items: SearchProviderItemV1[] = await searchActions(scope, context().signal);
    await searchActions({ ...scope, connectionId: 'another' }, context().signal);
    expect(mocks.hook).not.toHaveBeenCalled();
    const logs = items.find((item) => item.label === 'Logs: main')!;
    expect(logs).toBeDefined();
    expect(mocks.get).toHaveBeenCalledWith('kubernetes', 'prod', 'core::v1::Pod', { id: 'api', namespace: 'apps' });
    if (logs.value.kind !== 'action') throw new Error('Expected action');
    mocks.get.mockClear();
    const execution = executeSearchAction(logs.value.action, context());
    await act(async () => { await Promise.resolve(); });
    await execution;
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.deps.createLogSession).toHaveBeenCalledWith(expect.objectContaining({ target: 'main', resourceData: data }));
    mocks.deps.closeDrawer.mockClear();
    mocks.deps.createLogSession.mockRejectedValueOnce(new Error('Failed to create log session'));
    await expect(executeSearchAction(logs.value.action, context())).rejects.toThrow('Failed to create log session');
    expect(mocks.deps.closeDrawer).not.toHaveBeenCalled();
  });

  it('rejects changed UID before execution', async () => {
    render(<KubernetesSearchActionContext />);
    mocks.get.mockResolvedValue({ success: true, result: { ...data, metadata: { ...data.metadata, uid: 'replacement' } } });
    await expect(searchActions(scope, context().signal)).rejects.toThrow(/identity/);
    expect(mocks.deps.createLogSession).not.toHaveBeenCalled();
  });

  it('keeps native read failures distinct from no actions', async () => {
    render(<KubernetesSearchActionContext />);
    mocks.get.mockRejectedValue(new Error('Forbidden'));
    await expect(searchActions(scope, context().signal)).rejects.toThrow('Forbidden');
  });

  it('discovers cached descriptors without reads but bypasses cached data at execution', async () => {
    render(<KubernetesSearchActionContext />);
    const items = await searchActions(scope, context().signal, data);
    await searchActions(scope, context().signal, data);
    const logs = items.find(item => item.label === 'Logs: main')!;
    if (logs.value.kind !== 'action') throw new Error('Expected action');
    expect(mocks.get).not.toHaveBeenCalled();
    expect(await validateSearchAction(logs.value.action, context())).toBe(true);
    expect(await validateSearchAction({ id: 'missing', target: scope }, context())).toBe(false);
    expect(mocks.get).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue({ success: true, result: { ...data, metadata: { ...data.metadata, uid: 'replacement' } } });
    await expect(executeSearchAction(logs.value.action, context())).rejects.toThrow(/identity/);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.deps.createLogSession).not.toHaveBeenCalled();
  });

  it('rejects removed context and cancelled requests without reads', async () => {
    const mounted = render(<KubernetesSearchActionContext />);
    mounted.unmount();
    await expect(searchActions(scope, context().signal)).rejects.toThrow(/unavailable/);
    render(<KubernetesSearchActionContext />);
    const controller = new AbortController();
    controller.abort();
    await expect(searchActions(scope, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

// Discovery and execution intentionally use different snapshots in these tests.
const debugPod = {
  ...data,
  spec: {
    containers: [{ name: 'main' }, { name: 'worker' }, { name: 'stopped' }],
    initContainers: [{ name: 'setup' }], ephemeralContainers: [{ name: 'old-debugger' }],
  },
  status: {
    phase: 'Running',
    containerStatuses: [
      { name: 'main', state: { running: {} } },
      { name: 'worker', state: { running: {} } },
      { name: 'stopped', state: { waiting: { reason: 'CrashLoopBackOff' } } },
    ],
  },
};

describe('standalone palette Debug', () => {
  it('waits for preferences on the first Debug command and invokes the latest launch handler once', async () => {
    const loadingStart = vi.fn().mockRejectedValue(new Error('Debug preferences are loading'));
    mockDrawerState({
      deps: { ...mocks.deps, startDebug: loadingStart },
      dialogs: null, isBusy: false, isReady: false,
    });
    render(<KubernetesSearchActionContext />);
    const items = await searchActions(scope, context().signal, debugPod);
    const main = items.find(item => item.label === 'Debug: main')!;
    if (main.value.kind !== 'action') throw new Error('Expected action');
    mocks.get.mockResolvedValue({ success: true, result: debugPod });
    const settled = vi.fn();
    const execution = executeSearchAction(main.value.action, context()).then(
      () => settled('fulfilled'),
      error => settled(error),
    );
    const readyStart = vi.fn(async (_input: StartDebugInput) => {});
    try {
      await act(async () => { await Promise.resolve(); });
      expect(settled).not.toHaveBeenCalled();
      expect(loadingStart).not.toHaveBeenCalled();
    } finally {
      mockDrawerState({
        deps: { ...mocks.deps, startDebug: readyStart },
        dialogs: null, isBusy: false, isReady: true,
      });
      await execution;
    }
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith('fulfilled');
    expect(loadingStart).not.toHaveBeenCalled();
    expect(readyStart).toHaveBeenCalledTimes(1);
    expect(readyStart).toHaveBeenCalledWith({
      connectionID: 'prod', resourceID: 'api', namespace: 'apps', podUID: 'original',
      targetContainerName: 'main', resourceData: debugPod,
    });
  });

  it('cancels a first Debug command during preference loading and never launches after readiness', async () => {
    const loadingStart = vi.fn().mockRejectedValue(new Error('Debug preferences are loading'));
    mockDrawerState({
      deps: { ...mocks.deps, startDebug: loadingStart },
      dialogs: null, isBusy: false, isReady: false,
    });
    render(<KubernetesSearchActionContext />);
    const items = await searchActions(scope, context().signal, debugPod);
    const main = items.find(item => item.label === 'Debug: main')!;
    if (main.value.kind !== 'action') throw new Error('Expected action');
    mocks.get.mockResolvedValue({ success: true, result: debugPod });
    const controller = new AbortController();
    const settled = vi.fn();
    const execution = executeSearchAction(main.value.action, { ...context(), signal: controller.signal }).then(
      () => settled('fulfilled'),
      error => settled(error),
    );
    await act(async () => { await Promise.resolve(); });
    await act(async () => { controller.abort(); });
    await execution;
    mockDrawerState({
      deps: mocks.deps, dialogs: null, isBusy: false, isReady: true,
    });
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError' }));
    expect(loadingStart).not.toHaveBeenCalled();
    expect(mocks.deps.startDebug).not.toHaveBeenCalled();
  });

  it('offers named live targets and launches a selected container without a drawer', async () => {
    render(<KubernetesSearchActionContext />);
    const items = await searchActions(scope, context().signal, debugPod);
    expect(items.filter(item => item.value.kind === 'action' && item.value.action.id.startsWith('kubernetes:core::v1::Pod:Debug:')).map(item => item.label).sort())
      .toEqual(['Debug: main', 'Debug: worker']);
    expect(mocks.hook).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    const main = items.find(item => item.label === 'Debug: main')!;
    if (main.value.kind !== 'action') throw new Error('Expected action');
    mocks.get.mockResolvedValue({ success: true, result: debugPod });
    const execution = executeSearchAction(main.value.action, context());
    await act(async () => { await Promise.resolve(); });
    await execution;
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.deps.startDebug).toHaveBeenCalledTimes(1);
    expect(mocks.deps.startDebug).toHaveBeenCalledWith({
      connectionID: 'prod', resourceID: 'api', namespace: 'apps', podUID: 'original',
      targetContainerName: 'main', resourceData: debugPod,
    });
  });

  it.each(['stopped', 'removed', 'replaced', 'namespace-changed', 'static'])(
    'rejects a discovered Debug target when fresh Pod is %s', async (change) => {
      render(<KubernetesSearchActionContext />);
      const items = await searchActions(scope, context().signal, debugPod);
      const main = items.find(item => item.label === 'Debug: main');
      expect(main).toBeDefined();
      if (main!.value.kind !== 'action') throw new Error('Expected action');
      const fresh = {
        ...debugPod,
        metadata: {
          ...debugPod.metadata,
          ...(change === 'replaced' ? { uid: 'replacement' } : {}),
          ...(change === 'namespace-changed' ? { namespace: 'other' } : {}),
          ...(change === 'static' ? { annotations: { 'kubernetes.io/config.mirror': 'mirror' } } : {}),
        },
        spec: {
          ...debugPod.spec,
          containers: change === 'removed' ? [{ name: 'worker' }] : debugPod.spec.containers,
        },
        status: {
          ...debugPod.status,
          containerStatuses: debugPod.status.containerStatuses.map(status =>
            status.name === 'main' && change === 'stopped'
              ? { name: 'main', state: { waiting: { reason: 'CrashLoopBackOff' } } }
              : status),
        },
      };
      mocks.get.mockResolvedValue({ success: true, result: fresh });
      const execution = executeSearchAction(main!.value.action, context());
      const rejection = expect(execution).rejects.toThrow(/identity|available|executable|Choose/);
      await act(async () => { await Promise.resolve(); });
      await rejection;
      expect(mocks.get).toHaveBeenCalledTimes(1);
      expect(mocks.deps.startDebug).not.toHaveBeenCalled();
    },
  );

  it('launches a single target directly and preserves fresh data rather than cached discovery data', async () => {
    render(<KubernetesSearchActionContext />);
    const single = {
      ...debugPod,
      status: { ...debugPod.status, containerStatuses: [debugPod.status.containerStatuses[0]] },
    };
    const items = await searchActions(scope, context().signal, single);
    const debug = items.find(item => item.label === 'Debug');
    expect(debug).toBeDefined();
    if (debug!.value.kind !== 'action') throw new Error('Expected action');
    const fresh = { ...single, metadata: { ...single.metadata, resourceVersion: 'new-version' } };
    mocks.get.mockResolvedValue({ success: true, result: fresh });
    const execution = executeSearchAction(debug!.value.action, context());
    await act(async () => { await Promise.resolve(); });
    await execution;
    expect(mocks.deps.startDebug).toHaveBeenCalledTimes(1);
    expect(mocks.deps.startDebug).toHaveBeenCalledWith({
      connectionID: 'prod', resourceID: 'api', namespace: 'apps', podUID: 'original',
      targetContainerName: 'main', resourceData: fresh,
    });
  });

  it.each(['two-to-one', 'one-to-two'])('executes the discovered main target after a %s live-target change', async (change) => {
    render(<KubernetesSearchActionContext />);
    const single = {
      ...debugPod,
      status: { ...debugPod.status, containerStatuses: [debugPod.status.containerStatuses[0]] },
    };
    const discovery = change === 'two-to-one' ? debugPod : single;
    const fresh = change === 'two-to-one' ? single : debugPod;
    const items = await searchActions(scope, context().signal, discovery);
    const main = items.find(item => item.label === (change === 'two-to-one' ? 'Debug: main' : 'Debug'));
    expect(main).toBeDefined();
    if (main!.value.kind !== 'action') throw new Error('Expected action');
    mocks.get.mockResolvedValue({ success: true, result: fresh });
    const execution = executeSearchAction(main!.value.action, context());
    const result = expect(execution).resolves.toBeUndefined();
    await act(async () => { await Promise.resolve(); });
    await result;
    expect(mocks.deps.startDebug).toHaveBeenCalledTimes(1);
    expect(mocks.deps.startDebug).toHaveBeenCalledWith({
      connectionID: 'prod', resourceID: 'api', namespace: 'apps', podUID: 'original',
      targetContainerName: 'main', resourceData: fresh,
    });
  });

  it('rejects a vanished single target rather than launching its replacement', async () => {
    render(<KubernetesSearchActionContext />);
    const single = {
      ...debugPod,
      status: { ...debugPod.status, containerStatuses: [debugPod.status.containerStatuses[0]] },
    };
    const items = await searchActions(scope, context().signal, single);
    const main = items.find(item => item.label === 'Debug')!;
    if (main.value.kind !== 'action') throw new Error('Expected action');
    const fresh = {
      ...debugPod,
      status: { ...debugPod.status, containerStatuses: [debugPod.status.containerStatuses[1]] },
    };
    mocks.get.mockResolvedValue({ success: true, result: fresh });
    const execution = executeSearchAction(main.value.action, context());
    const rejection = expect(execution).rejects.toThrow(/available|executable|Choose/);
    await act(async () => { await Promise.resolve(); });
    await rejection;
    expect(mocks.deps.startDebug).not.toHaveBeenCalled();
  });

  it.each(['ready', 'timeout', 'unmount'])('settles deferred resolution on %s without Promise.withResolvers', async (outcome) => {
    const intrinsic = Object.getOwnPropertyDescriptor(Promise, 'withResolvers');
    Object.defineProperty(Promise, 'withResolvers', { configurable: true, writable: true, value: undefined });
    mockDrawerState({
      deps: mocks.deps, dialogs: null, isBusy: false, isReady: false,
    });
    const mounted = render(<KubernetesSearchActionContext />);
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const settled = vi.fn();
    let execution: Promise<void> | undefined;
    let timeout: number | undefined;
    try {
      const items = await searchActions(scope, context().signal, debugPod);
      const main = items.find(item => item.label === 'Debug: main')!;
      if (main.value.kind !== 'action') throw new Error('Expected action');
      mocks.get.mockResolvedValue({ success: true, result: debugPod });
      execution = executeSearchAction(main.value.action, { ...context(), signal: controller.signal }).then(
        () => { settled('fulfilled'); },
        error => { settled(error); },
      );
      await act(async () => { await Promise.resolve(); });
      expect(settled).not.toHaveBeenCalled();
      expect(mocks.deps.startDebug).not.toHaveBeenCalled();
      if (outcome === 'ready') {
        mockDrawerState({
          deps: mocks.deps, dialogs: null, isBusy: false, isReady: true,
        });
      } else if (outcome === 'timeout') {
        await act(async () => {
          await new Promise<void>((resolve) => {
            timeout = window.setTimeout(() => { controller.abort(); resolve(); }, 10);
          });
        });
      } else {
        mounted.unmount();
      }
      await execution;
      expect(settled).toHaveBeenCalledTimes(1);
      expect(settled).toHaveBeenCalledWith(outcome === 'ready'
        ? 'fulfilled'
        : expect.objectContaining(outcome === 'timeout'
          ? { name: 'AbortError' }
          : { message: 'Kubernetes search action context was removed' }));
      expect(mocks.deps.startDebug).toHaveBeenCalledTimes(outcome === 'ready' ? 1 : 0);
      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    } finally {
      window.clearTimeout(timeout);
      controller.abort();
      mounted.unmount();
      await execution;
      removeListener.mockRestore();
      if (intrinsic) Object.defineProperty(Promise, 'withResolvers', intrinsic);
      else Reflect.deleteProperty(Promise, 'withResolvers');
    }
  });

  it('blocks another palette launch while creation is pending and releases the guard after rejection', async () => {
    render(<KubernetesSearchActionContext />);
    const items = await searchActions(scope, context().signal, debugPod);
    const main = items.find(item => item.label === 'Debug: main');
    expect(main).toBeDefined();
    if (main!.value.kind !== 'action') throw new Error('Expected action');
    const { promise, reject: rejectStart } = Promise.withResolvers<void>();
    mocks.deps.startDebug.mockImplementationOnce(() => promise);
    mocks.get.mockResolvedValue({ success: true, result: debugPod });
    const execution = executeSearchAction(main!.value.action, context());
    const rejected = expect(execution).rejects.toThrow('Forbidden');
    await act(async () => { await Promise.resolve(); });
    try {
      expect(mocks.deps.startDebug).toHaveBeenCalledTimes(1);
      await expect(executeSearchAction(main!.value.action, context())).rejects.toThrow(/current|pending|starting/);
      expect(mocks.deps.startDebug).toHaveBeenCalledTimes(1);
    } finally {
      rejectStart(new Error('Forbidden'));
      await rejected;
    }
    await executeSearchAction(main!.value.action, context());
    expect(mocks.deps.startDebug).toHaveBeenCalledTimes(2);
  });
});
