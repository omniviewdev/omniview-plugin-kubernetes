import { ResourceClient } from '@omniviewdev/runtime/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DrawerActionDeps, StartDebugInput } from '../../components/shared/drawer/actionDeps';

import { BUILTIN_DEBUG_TEMPLATES } from './config';
import {
  getDebugRecords,
  inspectDebugRecord,
  observeDebugRecord,
  reconnectDebug,
  startDebugSession,
} from './controller';
import { isMissingShellError } from './targets';
vi.mock('@omniviewdev/runtime/api', () => ({ ResourceClient: { Get: vi.fn() } }));

beforeEach(() => {
  vi.mocked(ResourceClient.Get).mockReset();
});

describe('debug lifecycle observations', () => {
  const record = {
    connectionID: 'c',
    resourceID: 'p',
    namespace: 'n',
    podUID: 'original',
    targetContainerName: 'app',
    containerName: 'debugger-omniview-one',
    image: 'busybox:1.37.0',
    state: 'unknown' as const,
    certainty: 'unknown' as const,
    message: '',
  };
  it('does not infer rejection from an absent reserved name', () => {
    expect(observeDebugRecord(record, { metadata: { uid: 'original' } }).state).toBe('unknown');
  });
  it('keeps exact waiting reason and never uses another running container', () => {
    const next = observeDebugRecord(record, {
      metadata: { uid: 'original' },
      status: {
        ephemeralContainerStatuses: [
          {
            name: record.containerName,
            state: { waiting: { reason: 'ImagePullBackOff', message: 'denied' } },
          },
          { name: 'other', state: { running: {} } },
        ],
      },
    });
    expect(next.state).toBe('waiting');
    expect(next.message).toContain('ImagePullBackOff');
    expect(next.message).toContain('denied');
  });
  it('invalidates replacement identities', () => {
    expect(observeDebugRecord(record, { metadata: { uid: 'replacement' } }).state).toBe('stale');
  });
  it('preserves real termination result', () => {
    expect(
      observeDebugRecord(record, {
        metadata: { uid: 'original' },
        status: {
          ephemeralContainerStatuses: [
            {
              name: record.containerName,
              state: { terminated: { reason: 'Completed', exitCode: 0 } },
            },
          ],
        },
      }).message,
    ).toContain('0');
  });
  it('offers shell recovery only for missing executable errors', () => {
    expect(
      isMissingShellError({
        title: 'Exec failed',
        suggestion: '',
        raw: 'exec: "sh": executable file not found in $PATH',
      }),
    ).toBe(true);
    expect(
      isMissingShellError({ title: 'Forbidden', suggestion: '', raw: 'pods/exec denied' }),
    ).toBe(false);
  });
});

describe('shared create and attach transitions', () => {
  const input = (uid: string): StartDebugInput => ({
    connectionID: 'c',
    resourceID: 'p',
    namespace: 'n',
    podUID: uid,
    targetContainerName: 'app',
    resourceData: {
      metadata: { name: 'p', namespace: 'n', uid },
      spec: { containers: [{ name: 'app' }] },
      status: { phase: 'Running', containerStatuses: [{ name: 'app', state: { running: {} } }] },
    },
  });
  it('guards uncertain creation across callers and retains the reserved name', async () => {
    const launch = input('uncertain-create');
    const executeAction = vi
      .fn()
      .mockRejectedValue(new Error('DEBUG_CREATION_UNKNOWN: connection lost'));
    const deps = { executeAction, createExecSession: vi.fn() } as unknown as DrawerActionDeps;
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toThrow(
      'DEBUG_CREATION_UNKNOWN',
    );
    const reserved = executeAction.mock.calls[0][0].params.name;
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toThrow(
      /pending|unconfirmed/,
    );
    expect(executeAction).toHaveBeenCalledOnce();
    expect(getDebugRecords().find((record) => record.podUID === launch.podUID)).toMatchObject({
      containerName: reserved,
      certainty: 'unknown',
    });
  });
  it('reconnects accepted records to exact attach identity without creating again', async () => {
    const launch = input('attach-failure');
    const pod = {
      ...launch.resourceData,
      spec: {
        containers: [{ name: 'app' }],
        ephemeralContainers: [{ name: 'debugger-omniview-fixed', image: 'busybox:1.37.0' }],
      },
      status: {
        ephemeralContainerStatuses: [{ name: 'debugger-omniview-fixed', state: { running: {} } }],
      },
    };
    vi.mocked(ResourceClient.Get).mockResolvedValue({ success: true, result: pod } as never);
    const createExecSession = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'real-session' });
    const record = {
      ...launch,
      containerName: 'debugger-omniview-fixed',
      image: 'busybox:1.37.0',
      certainty: 'accepted' as const,
      state: 'running' as const,
      message: '',
    };
    await expect(reconnectDebug(record, { createExecSession })).rejects.toThrow(
      /Attachment failed/,
    );
    await reconnectDebug(record, { createExecSession });
    expect(createExecSession).toHaveBeenCalledTimes(2);
    for (const [request] of createExecSession.mock.calls)
      expect(request.opts.params).toEqual({
        mode: 'attach',
        container: record.containerName,
        pod_uid: launch.podUID,
      });
  });

  it.each([
    ['unsuccessful-get', { success: false }],
    ['empty-get-result', { success: true, result: null }],
  ])(
    'preserves uncertain creation and its guard after %s without confirmed deletion',
    async (uid, response) => {
      const launch = input(uid);
      const executeAction = vi
        .fn()
        .mockRejectedValue(new Error('connection lost after submission'));
      const createExecSession = vi.fn();
      const deps = { executeAction, createExecSession } as unknown as DrawerActionDeps;
      await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toThrow();
      const reserved = getDebugRecords().find((record) => record.podUID === launch.podUID)!;
      vi.mocked(ResourceClient.Get).mockResolvedValueOnce(response as never);

      await expect(inspectDebugRecord(reserved)).rejects.toBeDefined();
      expect(getDebugRecords().find((record) => record.podUID === launch.podUID)).toMatchObject({
        containerName: reserved.containerName,
        state: 'unknown',
        certainty: 'unknown',
      });
      await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toThrow(
        /pending|unconfirmed/,
      );
      expect(executeAction).toHaveBeenCalledOnce();
      expect(createExecSession).not.toHaveBeenCalled();
    },
  );

  it('preserves uncertain creation and its reserved-name guard when Pod GET throws transiently', async () => {
    const launch = input('transient-get-failure');
    const executeAction = vi.fn().mockRejectedValue(new Error('connection lost after submission'));
    const createExecSession = vi.fn();
    const deps = { executeAction, createExecSession } as unknown as DrawerActionDeps;
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toThrow();
    const reserved = getDebugRecords().find((record) => record.podUID === launch.podUID)!;
    const transportError = new Error('temporary connection failure');
    vi.mocked(ResourceClient.Get).mockRejectedValueOnce(transportError);

    await expect(inspectDebugRecord(reserved)).rejects.toBeDefined();
    expect(getDebugRecords().find((record) => record.podUID === launch.podUID)).toMatchObject({
      containerName: reserved.containerName,
      state: 'unknown',
      certainty: 'unknown',
    });
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toThrow(
      /pending|unconfirmed/,
    );
    expect(executeAction).toHaveBeenCalledOnce();
    expect(createExecSession).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid-response-after-submission', new Error('invalid response after submission')],
    [
      'cancelled-submission',
      { code: 'CANCELLED', title: 'Cancelled', message: 'Submission interrupted' },
    ],
    [
      'timeout-submission',
      { code: 'TIMEOUT', title: 'Timeout', message: 'Submission interrupted' },
    ],
    [
      'unknown-code-submission',
      { code: 'UNKNOWN_CODE', title: 'Invalid response', message: 'Submission interrupted' },
    ],
    [
      'internal-submission',
      {
        type: 'omniview:internal',
        title: 'Invalid response',
        status: 500,
        detail: 'Submission interrupted',
        code: 'INTERNAL',
      },
    ],
  ])('keeps %s unknown and blocks another submission', async (uid, error) => {
    const launch = input(uid);
    const executeAction = vi.fn().mockRejectedValue(error);
    const createExecSession = vi.fn();
    const deps = { executeAction, createExecSession } as unknown as DrawerActionDeps;

    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toBeDefined();
    const reserved = executeAction.mock.calls[0][0].params.name;
    expect(getDebugRecords().find((record) => record.podUID === launch.podUID)).toMatchObject({
      containerName: reserved,
      state: 'unknown',
      certainty: 'unknown',
    });
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toThrow(
      /pending|unconfirmed/,
    );
    expect(executeAction).toHaveBeenCalledOnce();
    expect(createExecSession).not.toHaveBeenCalled();
  });

  it.each([
    [
      'host-forbidden',
      {
        type: 'omniview:resource/forbidden',
        title: 'Access denied',
        status: 403,
        detail: 'Request rejected',
        code: 'FORBIDDEN',
      },
    ],
    ['sdk-forbidden', { code: 'FORBIDDEN', title: 'Access denied', message: 'Request rejected' }],
    [
      'host-invalid-request',
      {
        type: 'omniview:validation',
        title: 'Request rejected',
        status: 400,
        detail: 'Request rejected',
        code: 'INVALID_REQUEST',
      },
    ],
    [
      'sdk-invalid-request',
      { code: 'INVALID_REQUEST', title: 'Request rejected', message: 'Request rejected' },
    ],
  ])('records authoritative %s rejection and permits an explicit retry', async (uid, error) => {
    const launch = input(uid);
    const executeAction = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(new Error('connection lost after retry'));
    const createExecSession = vi.fn();
    const deps = { executeAction, createExecSession } as unknown as DrawerActionDeps;

    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toBeDefined();
    const rejectedName = executeAction.mock.calls[0][0].params.name;
    expect(getDebugRecords().find((record) => record.podUID === launch.podUID)).toMatchObject({
      containerName: rejectedName,
      state: 'rejected',
      certainty: 'rejected',
    });
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toThrow(
      'connection lost after retry',
    );
    expect(executeAction).toHaveBeenCalledTimes(2);
    expect(executeAction.mock.calls[1][0].params.name).not.toBe(rejectedName);
    expect(getDebugRecords().find((record) => record.containerName === rejectedName)).toMatchObject(
      {
        state: 'rejected',
        certainty: 'rejected',
      },
    );
    expect(createExecSession).not.toHaveBeenCalled();
  });

  it('treats explicit unsuccessful ActionResult as rejection and permits a retry', async () => {
    const launch = input('explicit-action-rejection');
    const executeAction = vi
      .fn()
      .mockResolvedValueOnce({ success: false, message: 'Request refused' })
      .mockRejectedValueOnce(new Error('connection lost after retry'));
    const deps = { executeAction, createExecSession: vi.fn() } as unknown as DrawerActionDeps;
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toBeDefined();
    expect(getDebugRecords().find((record) => record.podUID === launch.podUID)).toMatchObject({
      state: 'rejected',
      certainty: 'rejected',
    });
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toThrow(
      'connection lost after retry',
    );
    expect(executeAction).toHaveBeenCalledTimes(2);
  });

  it('does not infer rejection from a null ActionResult', async () => {
    const launch = input('null-action-result');
    const executeAction = vi.fn().mockResolvedValue(null);
    const deps = { executeAction, createExecSession: vi.fn() } as unknown as DrawerActionDeps;
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toBeDefined();
    expect(getDebugRecords().find((record) => record.podUID === launch.podUID)).toMatchObject({
      containerName: executeAction.mock.calls[0][0].params.name,
      state: 'unknown',
      certainty: 'unknown',
    });
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toThrow(
      /pending|unconfirmed/,
    );
    expect(executeAction).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'host-not-found',
      {
        type: 'omniview:resource/not-found',
        title: 'Pod missing',
        status: 404,
        detail: 'Pod deleted',
        code: 'NOT_FOUND',
      },
    ],
    ['sdk-not-found', { code: 'NOT_FOUND', title: 'Pod missing', message: 'Pod deleted' }],
  ])(
    'invalidates the old record after confirmed %s without attaching to a replacement',
    async (uid, error) => {
      const launch = input(uid);
      const executeAction = vi
        .fn()
        .mockRejectedValue(new Error('connection lost after submission'));
      const createExecSession = vi.fn();
      const deps = { executeAction, createExecSession } as unknown as DrawerActionDeps;
      await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toThrow();
      const reserved = getDebugRecords().find((record) => record.podUID === launch.podUID)!;
      vi.mocked(ResourceClient.Get).mockRejectedValueOnce(error);

      await expect(inspectDebugRecord(reserved)).rejects.toBeDefined();
      const stale = getDebugRecords().find((record) => record.podUID === launch.podUID)!;
      expect(stale).toMatchObject({
        containerName: reserved.containerName,
        podUID: launch.podUID,
        state: 'stale',
      });
      vi.mocked(ResourceClient.Get).mockResolvedValueOnce({
        success: true,
        result: input(`${uid}-replacement`).resourceData,
      } as never);
      await expect(reconnectDebug(stale, { createExecSession })).rejects.toBeDefined();
      expect(createExecSession).not.toHaveBeenCalled();
      expect(executeAction).toHaveBeenCalledOnce();
      expect(
        getDebugRecords().find((record) => record.containerName === reserved.containerName),
      ).toMatchObject({
        podUID: launch.podUID,
        state: 'stale',
      });
    },
  );
  it('preserves the authoritative image failure when attachment cannot start', async () => {
    const launch = input('image-failure-after-create');
    const record = {
      ...launch,
      containerName: 'debugger-image-failure',
      image: 'missing:tag',
      certainty: 'accepted' as const,
      state: 'waiting' as const,
      message: '',
    };
    const pod = {
      ...launch.resourceData,
      spec: {
        containers: [{ name: 'app' }],
        ephemeralContainers: [{ name: record.containerName, image: record.image }],
      },
    };
    vi.mocked(ResourceClient.Get)
      .mockResolvedValueOnce({
        success: true,
        result: {
          ...pod,
          status: {
            ephemeralContainerStatuses: [
              { name: record.containerName, state: { waiting: { reason: 'ContainerCreating' } } },
            ],
          },
        },
      } as never)
      .mockResolvedValueOnce({
        success: true,
        result: {
          ...pod,
          status: {
            ephemeralContainerStatuses: [
              {
                name: record.containerName,
                state: { waiting: { reason: 'ErrImagePull', message: 'manifest not found' } },
              },
            ],
          },
        },
      } as never);
    const createExecSession = vi.fn().mockResolvedValue(null);
    await expect(reconnectDebug(record, { createExecSession })).rejects.toThrow('ErrImagePull');
    expect(getDebugRecords().find((item) => item.podUID === launch.podUID)).toMatchObject({
      state: 'waiting',
      certainty: 'accepted',
      message: 'ErrImagePull: manifest not found',
    });
    expect(createExecSession).toHaveBeenCalledTimes(1);
  });

  it('does not turn an opened terminal into an attachment failure because a later status read is unavailable', async () => {
    const launch = input('opened-stream-status-unavailable');
    const record = {
      ...launch,
      containerName: 'debugger-opened',
      image: 'busybox:1.37.0',
      certainty: 'accepted' as const,
      state: 'running' as const,
      message: '',
    };
    const pod = {
      ...launch.resourceData,
      spec: {
        containers: [{ name: 'app' }],
        ephemeralContainers: [{ name: record.containerName, image: record.image }],
      },
      status: {
        ephemeralContainerStatuses: [{ name: record.containerName, state: { running: {} } }],
      },
    };
    vi.mocked(ResourceClient.Get)
      .mockResolvedValueOnce({ success: true, result: pod } as never)
      .mockRejectedValueOnce(new Error('Status service unavailable'));
    await expect(
      reconnectDebug(record, {
        createExecSession: vi.fn().mockResolvedValue({ id: 'opened-stream' }),
      }),
    ).resolves.toBeUndefined();
    expect(getDebugRecords().find((item) => item.podUID === launch.podUID)).toMatchObject({
      state: 'running',
      certainty: 'accepted',
    });
  });
});
