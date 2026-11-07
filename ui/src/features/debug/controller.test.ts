import { jsonToValue, valueToJSON, type Value } from '@omniviewdev/runtime';
import { resolveKubernetesReference } from '../../utils/kubernetesReference';
vi.mock('../../utils/kubernetesReference', () => ({ resolveKubernetesReference: vi.fn() }));
import { ResourceClient } from '@omniviewdev/runtime/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pod } from 'kubernetes-types/core/v1';
vi.mock('@/pluginId', () => ({ PLUGIN_ID: 'alternate-kube' }));

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

function actionName(input: Value): string {
  const parameters = valueToJSON(input);
  if (!parameters || typeof parameters !== 'object' || !('name' in parameters) || typeof parameters.name !== 'string') {
    throw new Error('Expected a named debug action');
  }
  return parameters.name;
}

function podRecord(pod: Pod | null) {
  return {
    route: { connection: 'c' },
    record: {
      body: jsonToValue(pod),
      reference: {
        address: { provider: 'kubernetes', authority: 'native-authority', type: 'k8s:/pods',
          scope: [{ dimension: 'namespace', value: pod?.metadata?.namespace ?? 'n' }],
          id: pod?.metadata?.name ?? 'p' },
        incarnation: pod?.metadata?.uid,
      },
    },
  };
}

beforeEach(() => {
  vi.mocked(ResourceClient.Get).mockReset();
  vi.mocked(resolveKubernetesReference).mockImplementation(async input => ({
    route: { connection: input.connectionID },
    targetId: 'debug-target', representation: 'raw-v1',
    reference: { address: {
      provider: 'kubernetes', authority: 'host-authority', type: input.resourceType,
      scope: [{ dimension: 'namespace', value: input.namespace! }], id: input.name,
    }, ...(input.incarnation ? { incarnation: input.incarnation } : {}) },
  }) as never);
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
    const failure = new Error('DEBUG_CREATION_UNKNOWN: connection lost');
    const executeAction = vi.fn().mockRejectedValue(failure);
    const deps = { executeAction, createExecSession: vi.fn() } as unknown as DrawerActionDeps;
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toBe(failure);
    const reserved = actionName(executeAction.mock.calls[0][0].input);
    expect(executeAction.mock.calls[0][0]).toMatchObject({
      route: { connection: launch.connectionID }, action: 'debug-create',
      reference: { incarnation: launch.podUID, address: {
        type: 'k8s:/pods', id: launch.resourceID,
        scope: [{ dimension: 'namespace', value: launch.namespace }],
      } },
    });
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toMatchObject({ name: 'Error' });
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
    const body = jsonToValue({ ...pod, exactCounter: 9007199254740993n });
    const reference = {
      address: { provider: 'kubernetes', authority: 'native-authority', type: 'k8s:/pods',
        scope: [{ dimension: 'namespace', value: launch.namespace }], id: launch.resourceID },
      incarnation: launch.podUID,
    };
    const route = { connection: launch.connectionID };
    vi.mocked(ResourceClient.Get).mockResolvedValue({ route, record: { body, reference } } as never);
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
    await expect(reconnectDebug(record, { createExecSession })).rejects.toMatchObject({ name: 'Error' });
    await reconnectDebug(record, { createExecSession });
    expect(createExecSession).toHaveBeenCalledTimes(2);
    for (const [request] of createExecSession.mock.calls) {
      expect(request.opts.resource_data).toBe(body);
      expect(request.opts.reference).toBe(reference);
      expect(request.opts.route).toBe(route);
      expect(request.opts.resource_plugin).toBe('kubernetes');
      expect(request.opts.params).toEqual({
        mode: 'attach',
        container: record.containerName,
        pod_uid: launch.podUID,
      });
    }
    expect(ResourceClient.Get).toHaveBeenCalledWith('alternate-kube', {
      targetId: 'debug-target',
      request: {
        route: { connection: launch.connectionID },
        representation: 'raw-v1',
        reference: {
          address: {
            provider: 'kubernetes',
            authority: 'host-authority',
            type: 'k8s:/pods',
            scope: [{ dimension: 'namespace', value: launch.namespace }],
            id: launch.resourceID,
          },
        },
      },
    });
  });

  it.each([
    ['unsuccessful-get', { success: false }],
    ['empty-get-result', podRecord(null)],
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
      await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toMatchObject({ name: 'Error' });
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
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toMatchObject({ name: 'Error' });
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
    [
      'postdispatch-provider-error',
      {
        type: 'omniview:resource/provider-error', code: 'PROVIDER_ERROR',
        title: 'Provider error', status: 409,
        detail: 'The provider lost confirmation after dispatch.',
      },
    ],
    [
      'postdispatch-reset-required',
      {
        type: 'omniview:resource/reset-required', code: 'RESET_REQUIRED',
        title: 'Resource context changed', status: 409,
        detail: 'The action completed after its catalog generation changed.',
      },
    ],
    [
      'postdispatch-cancelled-conflict-status',
      {
        type: 'omniview:cancelled', code: 'CANCELLED', title: 'Cancelled', status: 409,
        detail: 'The action was interrupted after dispatch.',
      },
    ],
    [
      'postdispatch-timeout-conflict-status',
      {
        type: 'omniview:timeout', code: 'TIMEOUT', title: 'Timeout', status: 409,
        detail: 'The action timed out after dispatch.',
      },
    ],
  ])('keeps %s unknown and blocks another submission', async (uid, error) => {
    const launch = input(uid);
    const executeAction = vi.fn().mockRejectedValue(error);
    const createExecSession = vi.fn();
    const deps = { executeAction, createExecSession } as unknown as DrawerActionDeps;

    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toBeDefined();
    const reserved = actionName(executeAction.mock.calls[0][0].input);
    expect(valueToJSON(executeAction.mock.calls[0][0].input)).toMatchObject({
      name: reserved, podUID: launch.podUID,
    });
    expect(getDebugRecords().find((record) => record.podUID === launch.podUID)).toMatchObject({
      containerName: reserved,
      state: 'unknown',
      certainty: 'unknown',
    });
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toMatchObject({ name: 'Error' });
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
    [
      'native-authoritative-conflict',
      {
        type: 'omniview:resource/conflict', code: 'CONFLICT',
        title: 'Conflict', status: 409, detail: 'Native precondition rejected the write.',
      },
    ],
  ])('records authoritative %s rejection and permits an explicit retry', async (uid, error) => {
    const launch = input(uid);
    const retryFailure = new Error('connection lost after retry');
    const executeAction = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(retryFailure);
    const createExecSession = vi.fn();
    const deps = { executeAction, createExecSession } as unknown as DrawerActionDeps;

    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toBeDefined();
    const rejectedName = actionName(executeAction.mock.calls[0][0].input);
    expect(getDebugRecords().find((record) => record.podUID === launch.podUID)).toMatchObject({
      containerName: rejectedName,
      state: 'rejected',
      certainty: 'rejected',
    });
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toBe(retryFailure);
    expect(executeAction).toHaveBeenCalledTimes(2);
    expect(actionName(executeAction.mock.calls[1][0].input)).not.toBe(rejectedName);
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
    const retryFailure = new Error('connection lost after retry');
    const executeAction = vi
      .fn()
      .mockResolvedValueOnce(jsonToValue({ success: false, message: 'Request refused' }))
      .mockRejectedValueOnce(retryFailure);
    const deps = { executeAction, createExecSession: vi.fn() } as unknown as DrawerActionDeps;
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toBeDefined();
    expect(getDebugRecords().find((record) => record.podUID === launch.podUID)).toMatchObject({
      state: 'rejected',
      certainty: 'rejected',
    });
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toBe(retryFailure);
    expect(executeAction).toHaveBeenCalledTimes(2);
  });

  it('retains the reserved identity after PROVIDER_ERROR until manual inspection reconciles it', async () => {
    const launch = input('provider-error-reconciliation');
    const executeAction = vi.fn().mockRejectedValue({
      code: 'PROVIDER_ERROR', retryable: false, status: 500,
      title: 'Provider error', detail: 'Debug creation could not be confirmed.',
    });
    const createExecSession = vi.fn();
    const deps = { executeAction, createExecSession } as unknown as DrawerActionDeps;
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    const reserved = actionName(executeAction.mock.calls[0][0].input);
    expect(getDebugRecords().find(record => record.podUID === launch.podUID)).toMatchObject({
      containerName: reserved, state: 'unknown', certainty: 'unknown',
    });
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toMatchObject({ name: 'Error' });
    expect(executeAction).toHaveBeenCalledOnce();
    expect(createExecSession).not.toHaveBeenCalled();
    vi.mocked(ResourceClient.Get).mockResolvedValueOnce(podRecord(launch.resourceData) as never);
    const inspected = await inspectDebugRecord(getDebugRecords().find(record => record.podUID === launch.podUID)!);
    expect(inspected.record).toMatchObject({ containerName: reserved, certainty: 'unknown' });
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toMatchObject({ name: 'Error' });
    expect(executeAction).toHaveBeenCalledOnce();
    const reservedRecord = getDebugRecords().find(record => record.podUID === launch.podUID)!;
    const reconciledPod = {
      ...launch.resourceData,
      spec: { ...launch.resourceData.spec, ephemeralContainers: [reservedRecord.expectedEntry!] },
      status: { ephemeralContainerStatuses: [{ name: reserved, state: { running: {} } }] },
    };
    vi.mocked(ResourceClient.Get).mockResolvedValue(podRecord(reconciledPod) as never);
    const reconciled = await inspectDebugRecord(reservedRecord);
    expect(reconciled.record).toMatchObject({ containerName: reserved, certainty: 'accepted', state: 'running' });
    createExecSession.mockResolvedValue({ id: 'reconciled-session' });
    await reconnectDebug(reconciled.record, { createExecSession });
    expect(createExecSession).toHaveBeenCalledOnce();
    expect(executeAction).toHaveBeenCalledOnce();
  });

  it('does not infer rejection from a null ActionResult', async () => {
    const launch = input('null-action-result');
    const executeAction = vi.fn().mockResolvedValue(null);
    const deps = { executeAction, createExecSession: vi.fn() } as unknown as DrawerActionDeps;
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toBeDefined();
    expect(getDebugRecords().find((record) => record.podUID === launch.podUID)).toMatchObject({
      containerName: actionName(executeAction.mock.calls[0][0].input),
      state: 'unknown',
      certainty: 'unknown',
    });
    await expect(startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps)).rejects.toMatchObject({ name: 'Error' });
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
      vi.mocked(ResourceClient.Get).mockResolvedValueOnce(podRecord(input(`${uid}-replacement`).resourceData) as never);
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
      .mockResolvedValueOnce(podRecord({
        ...pod,
        status: {
          ephemeralContainerStatuses: [
            { name: record.containerName, state: { waiting: { reason: 'ContainerCreating' } } },
          ],
        },
      }) as never)
      .mockResolvedValueOnce(podRecord({
        ...pod,
        status: {
          ephemeralContainerStatuses: [
            {
              name: record.containerName,
              state: { waiting: { reason: 'ErrImagePull', message: 'manifest not found' } },
            },
          ],
        },
      }) as never);
    const createExecSession = vi.fn().mockResolvedValue(null);
    await expect(reconnectDebug(record, { createExecSession })).rejects.toMatchObject({
      name: 'Error',
      cause: { name: 'Error' },
    });
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
      .mockResolvedValueOnce(podRecord(pod) as never)
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

  it('does not resurrect a rejected creation when an older status request finishes', async () => {
    const launch = input('rejected-during-inspection');
    let rejectCreation!: (reason: unknown) => void;
    const executeAction = vi.fn(() => new Promise<never>((_resolve, reject) => {
      rejectCreation = reject;
    }));
    const deps = { executeAction, createExecSession: vi.fn() } as unknown as DrawerActionDeps;
    const starting = startDebugSession(launch, BUILTIN_DEBUG_TEMPLATES[0], deps);
    const rejection = expect(starting).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const reserved = getDebugRecords().find((record) => record.podUID === launch.podUID)!;
    let finishInspection!: (response: never) => void;
    vi.mocked(ResourceClient.Get).mockReturnValueOnce(new Promise<never>((resolve) => {
      finishInspection = resolve;
    }));
    const inspecting = inspectDebugRecord(reserved);
    await Promise.resolve();

    rejectCreation({ code: 'FORBIDDEN', title: 'Access denied', message: 'Debugging denied' });
    await rejection;
    finishInspection(podRecord(launch.resourceData) as never);

    expect((await inspecting).record).toMatchObject({
      state: 'rejected',
      certainty: 'rejected',
    });
    expect(getDebugRecords().find((record) => record.containerName === reserved.containerName))
      .toMatchObject({ state: 'rejected', certainty: 'rejected' });
  });

  it.each([
    { name: 'nonempty proxy', proxy: 'http://proxy.invalid', serverProxy: { name: 'HTTP_PROXY', value: 'http://proxy.invalid' } },
    { name: 'empty proxy', proxy: '', serverProxy: { name: 'HTTP_PROXY' } },
  ])('reconciles an uncertain creation with server byte order and $name', async ({ name, proxy, serverProxy }) => {
    const launch = input(`environment-byte-order-${name}`);
    const template = {
      ...BUILTIN_DEBUG_TEMPLATES[0],
      env: { HTTP_PROXY: proxy, HTTPS_PROXY: 'https://proxy.invalid', _DEBUG: '1', lower: 'x' },
    };
    const deps = {
      executeAction: vi.fn().mockRejectedValue({ code: 'TIMEOUT', title: 'Timeout', message: 'No response' }),
      createExecSession: vi.fn(),
    } as unknown as DrawerActionDeps;
    await expect(startDebugSession(launch, template, deps)).rejects.toMatchObject({ code: 'TIMEOUT' });
    const reserved = getDebugRecords().find((record) => record.podUID === launch.podUID)!;
    vi.mocked(ResourceClient.Get).mockResolvedValueOnce(podRecord({
      ...launch.resourceData,
      spec: {
        ...launch.resourceData.spec,
        ephemeralContainers: [{
          ...reserved.expectedEntry,
          env: [
            { name: 'HTTPS_PROXY', value: 'https://proxy.invalid' },
            serverProxy,
            { name: '_DEBUG', value: '1' },
            { name: 'lower', value: 'x' },
          ],
        }],
      },
      status: {
        ephemeralContainerStatuses: [{ name: reserved.containerName, state: { running: {} } }],
      },
    }) as never);

    expect((await inspectDebugRecord(reserved)).record).toMatchObject({
      state: 'running',
      certainty: 'accepted',
    });
  });
});
