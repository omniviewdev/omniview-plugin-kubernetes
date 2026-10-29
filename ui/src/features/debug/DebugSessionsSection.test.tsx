import { ResourceClient } from '@omniviewdev/runtime/api';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Pod } from 'kubernetes-types/core/v1';
import { describe, expect, it, vi } from 'vitest';

import type { DrawerActionDeps, StartDebugInput } from '../../components/shared/drawer/actionDeps';

import { BUILTIN_DEBUG_TEMPLATES } from './config';
import { getDebugRecords, startDebugSession } from './controller';
import DebugSessionsSection from './DebugSessionsSection';


const mocks = vi.hoisted(() => ({
  createSession: vi.fn().mockResolvedValue({ id: 'replacement-stream' }),
}));
vi.mock('@omniviewdev/runtime', () => ({
  useExec: () => ({ createSession: mocks.createSession }),
  parseAppError: () => ({
    code: 'INTERNAL',
    status: 500,
    title: 'Error',
    detail: 'Connection lost',
  }),
}));
vi.mock('@omniviewdev/runtime/api', () => ({ ResourceClient: { Get: vi.fn() } }));

describe('debug sessions across Pod replacement', () => {
  it('discovers a same-named debugger on the new UID while retaining the old stale record', async () => {
    const original: StartDebugInput = {
      connectionID: 'replacement-session-cluster',
      resourceID: 'app',
      namespace: 'debug-test',
      podUID: 'retired-session-pod',
      targetContainerName: 'main',
      resourceData: {
        metadata: { name: 'app', namespace: 'debug-test', uid: 'retired-session-pod' },
        spec: { containers: [{ name: 'main' }] },
        status: {
          phase: 'Running',
          containerStatuses: [
            {
              name: 'main',
              image: 'pause:3.10',
              imageID: 'sha256:fixture',
              ready: true,
              restartCount: 0,
              state: { running: {} },
            },
          ],
        },
      },
    };
    const deps = {
      executeAction: vi.fn().mockRejectedValue(new Error('Connection lost')),
      createExecSession: vi.fn(),
    } as unknown as DrawerActionDeps;
    await expect(startDebugSession(original, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toThrow(
      'Connection lost',
    );
    const reserved = getDebugRecords().find((record) => record.podUID === original.podUID)!;
    const replacement: Pod = {
      ...original.resourceData,
      metadata: { name: 'app', namespace: 'debug-test', uid: 'replacement-session-pod' },
      spec: {
        containers: [{ name: 'main' }],
        ephemeralContainers: [
          { name: reserved.containerName, image: 'busybox:1.37.0', targetContainerName: 'main' },
        ],
      },
      status: {
        phase: 'Running',
        ephemeralContainerStatuses: [
          {
            name: reserved.containerName,
            image: 'busybox:1.37.0',
            imageID: 'sha256:toolbox',
            ready: true,
            restartCount: 0,
            state: { running: {} },
          },
        ],
      },
    };
    vi.mocked(ResourceClient.Get).mockResolvedValue({
      success: true,
      result: replacement,
    } as never);
    render(<DebugSessionsSection connectionID={original.connectionID} pod={replacement} />);
    expect(screen.getByText(/stale.*Pod identity changed/).textContent).toMatch(/^stale/);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        opts: expect.objectContaining({
          params: {
            mode: 'attach',
            container: reserved.containerName,
            pod_uid: 'replacement-session-pod',
          },
        }),
      }),
    );
    expect(deps.executeAction).toHaveBeenCalledTimes(1);
  });
  it('clears a failed status check after a successful read-only retry', async () => {
    const pod: Pod = {
      metadata: { name: 'app', namespace: 'debug-test', uid: 'status-retry-pod' },
      spec: {
        containers: [{ name: 'main' }],
        ephemeralContainers: [
          { name: 'debugger-status-retry', image: 'busybox:1.37.0', targetContainerName: 'main' },
        ],
      },
      status: {
        phase: 'Running',
        ephemeralContainerStatuses: [
          {
            name: 'debugger-status-retry',
            image: 'busybox:1.37.0',
            imageID: 'sha256:toolbox',
            ready: true,
            restartCount: 0,
            state: { running: {} },
          },
        ],
      },
    };
    mocks.createSession.mockClear();
    vi.mocked(ResourceClient.Get)
      .mockReset()
      .mockRejectedValueOnce(new Error('Temporary connection failure'))
      .mockResolvedValue({ success: true, result: pod } as never);
    render(<DebugSessionsSection connectionID="status-retry-cluster" pod={pod} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect status' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect status' }));
    await waitFor(() =>
      expect(
        getDebugRecords().find((record) => record.podUID === 'status-retry-pod')?.certainty,
      ).toBe('accepted'),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it('offers reconnect only after a waiting image becomes running, without reverting to the cached Pod snapshot', async () => {
    const pod: Pod = {
      metadata: {
        name: 'image-pull',
        namespace: 'ns',
        uid: 'image-pull-pod',
        resourceVersion: 'before-ready',
      },
      spec: {
        containers: [{ name: 'main' }],
        ephemeralContainers: [
          { name: 'debugger-image-pull', image: 'busybox:1.37.0', targetContainerName: 'main' },
        ],
      },
      status: {
        phase: 'Running',
        ephemeralContainerStatuses: [
          {
            name: 'debugger-image-pull',
            image: 'busybox:1.37.0',
            imageID: '',
            ready: false,
            restartCount: 0,
            state: { waiting: { reason: 'ErrImagePull', message: 'manifest not found' } },
          },
        ],
      },
    };
    const ready: Pod = {
      ...pod,
      metadata: { ...pod.metadata, resourceVersion: 'after-ready' },
      status: {
        phase: 'Running',
        ephemeralContainerStatuses: [
          {
            name: 'debugger-image-pull',
            image: 'busybox:1.37.0',
            imageID: 'sha256:toolbox',
            ready: true,
            restartCount: 0,
            state: { running: {} },
          },
        ],
      },
    };
    mocks.createSession.mockClear();
    vi.mocked(ResourceClient.Get)
      .mockReset()
      .mockResolvedValue({ success: true, result: ready } as never);
    const view = render(<DebugSessionsSection connectionID="image-pull-cluster" pod={pod} />);
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect status' }));
    await screen.findByRole('button', { name: 'Reconnect' });
    view.rerender(<DebugSessionsSection connectionID="image-pull-cluster" pod={{ ...pod }} />);
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
