import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchExecutionContextV1, SearchProviderItemV1, SearchScopeV1 } from '@omniviewdev/runtime';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  hook: vi.fn(),
  deps: { createLogSession: vi.fn().mockResolvedValue({ id: 'session' }), closeDrawer: vi.fn() },
}));
vi.mock('@omniviewdev/runtime/api', () => ({ ResourceClient: { Get: mocks.get } }));
vi.mock('../shared/drawer/DrawerActionsBridge', () => ({
  useDrawerActionExecution: () => { mocks.hook(); return { deps: mocks.deps, dialogs: null, isBusy: false }; },
}));

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
  mocks.hook.mockClear();
  mocks.deps.createLogSession.mockClear();
  mocks.deps.closeDrawer.mockClear();
});
afterEach(cleanup);

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
