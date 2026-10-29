import { parseAppError } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import type { EphemeralContainer, Pod } from 'kubernetes-types/core/v1';

import type { DrawerActionDeps, StartDebugInput } from '../../components/shared/drawer/actionDeps';

import type { DebugTemplate } from './config';
import { runningDebugTargets } from './targets';

export type DebugRecord = Omit<StartDebugInput, 'resourceData'> & {
  containerName: string;
  image: string;
  state:
    | 'creating'
    | 'unknown'
    | 'waiting'
    | 'running'
    | 'disconnected'
    | 'terminated'
    | 'stale'
    | 'rejected';
  certainty: 'unknown' | 'accepted' | 'rejected';
  message: string;
  expectedEntry?: EphemeralContainer;
};
const records = new Map<string, DebugRecord>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: DebugRecord[] = [];
const key = (input: Pick<StartDebugInput, 'connectionID' | 'namespace' | 'podUID'>) =>
  JSON.stringify([input.connectionID, input.namespace, input.podUID]);
const publish = (record: DebugRecord) => {
  records.set(`${key(record)}:${record.containerName}`, record);
  snapshot = [...records.values()];
  listeners.forEach((listener) => listener());
};
export const subscribeDebugRecords = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getDebugRecords = () => snapshot;
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item))
      return Object.fromEntries(
        Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
      );
    return item;
  }) ?? 'null';

export function observeDebugRecord(record: DebugRecord, pod: Pod): DebugRecord {
  if (pod.metadata?.uid !== record.podUID)
    return {
      ...record,
      state: 'stale',
      message: 'Pod identity changed. This session is no longer available.',
    };
  if (['stale', 'terminated', 'rejected'].includes(record.state)) return record;
  const entry = pod.spec?.ephemeralContainers?.find((item) => item.name === record.containerName);
  if (record.certainty === 'unknown' && record.expectedEntry && !entry) return record;
  if (record.certainty === 'unknown' && record.expectedEntry && entry) {
    const expected = record.expectedEntry;
    const fields = [
      'name',
      'image',
      'command',
      'args',
      'imagePullPolicy',
      'stdin',
      'tty',
      'targetContainerName',
      'securityContext',
      'env',
      'envFrom',
      'volumeMounts',
      'volumeDevices',
    ] as const;
    if (
      fields.some((field) => canonical(entry[field] ?? null) !== canonical(expected[field] ?? null))
    ) {
      return {
        ...record,
        state: 'unknown',
        message:
          'Reserved name exists but the complete requested configuration does not match. Creation remains unconfirmed.',
      };
    }
  }
  const status = pod.status?.ephemeralContainerStatuses?.find(
    (item) => item.name === record.containerName,
  );
  if (status?.state?.terminated) {
    const exit = status.state.terminated;
    return {
      ...record,
      certainty: 'accepted',
      state: 'terminated',
      message: `${exit.reason ?? 'Terminated'} (exit ${exit.exitCode}): ${exit.message ?? ''}`,
    };
  }
  if (status?.state?.waiting) {
    const wait = status.state.waiting;
    return {
      ...record,
      certainty: 'accepted',
      state: 'waiting',
      message: `${wait.reason ?? 'Waiting'}: ${wait.message ?? ''}`,
    };
  }
  if (status?.state?.running)
    return {
      ...record,
      certainty: 'accepted',
      state: record.state === 'disconnected' ? 'disconnected' : 'running',
      message: 'Observed running. Process namespace visibility depends on the runtime.',
    };
  if (pod.spec?.ephemeralContainers?.some((item) => item.name === record.containerName))
    return {
      ...record,
      certainty: 'accepted',
      state: 'waiting',
      message: 'Addition accepted. Waiting for the selected container status.',
    };
  return record;
}

function applyPodObservation(record: DebugRecord, pod: Pod): DebugRecord {
  record = records.get(`${key(record)}:${record.containerName}`) ?? record;
  const next = observeDebugRecord(record, pod);
  publish(next);
  const waitingReason =
    pod.status?.ephemeralContainerStatuses?.find((item) => item.name === record.containerName)
      ?.state?.waiting?.reason ?? '';
  if (
    ['running', 'terminated', 'stale', 'disconnected'].includes(next.state) ||
    (next.state === 'waiting' && /BackOff|Err|Failed/i.test(waitingReason))
  )
    pending.delete(key(record));
  return next;
}

export function syncDebugPodRecords(connectionID: string, pod: Pod): void {
  for (const record of records.values()) {
    if (
      record.connectionID === connectionID &&
      record.resourceID === pod.metadata?.name &&
      record.namespace === pod.metadata?.namespace
    ) {
      applyPodObservation(record, pod);
    }
  }
}
export async function inspectDebugRecord(
  record: DebugRecord,
): Promise<{ record: DebugRecord; pod: Pod }> {
  record = records.get(`${key(record)}:${record.containerName}`) ?? record;
  if (record.state === 'stale') throw new Error(record.message);
  let pod: Pod;
  try {
    const response = await ResourceClient.Get('kubernetes', record.connectionID, 'core::v1::Pod', {
      id: record.resourceID,
      namespace: record.namespace,
    });
    if (response?.success !== true || !response.result)
      throw new Error('Pod status could not be confirmed. Inspect again before taking action.');
    pod = response.result as Pod;
    if (typeof pod.metadata?.uid !== 'string' || !pod.metadata.uid)
      throw new Error('Pod status could not be confirmed. Inspect again before taking action.');
  } catch (error) {
    const parsed = parseAppError(error);
    if (parsed.code === 'NOT_FOUND' || parsed.status === 404) {
      publish({ ...record, state: 'stale', message: `${parsed.title}: ${parsed.detail}` });
      pending.delete(key(record));
    }
    throw error;
  }
  return { record: applyPodObservation(record, pod), pod };
}
export async function reconnectDebug(
  record: DebugRecord,
  deps: Pick<DrawerActionDeps, 'createExecSession'>,
): Promise<void> {
  const observed = await inspectDebugRecord(record);
  if (['stale', 'terminated', 'rejected'].includes(observed.record.state))
    throw new Error(observed.record.message);
  if (observed.record.certainty !== 'accepted')
    throw new Error('Creation remains unconfirmed. Inspect status; do not submit another request.');
  if (!observed.pod.spec?.ephemeralContainers?.some((item) => item.name === record.containerName))
    throw new Error('Debug container is no longer available');
  try {
    const session = await deps.createExecSession({
      connectionID: record.connectionID,
      label: `${record.resourceID}/${record.targetContainerName} → ${record.containerName}`,
      icon: 'LuBugPlay',
      opts: {
        resource_plugin: 'kubernetes',
        resource_key: 'core::v1::Pod',
        resource_data: observed.pod,
        params: { mode: 'attach', container: record.containerName, pod_uid: record.podUID },
      },
    });
    if (!session) throw new Error('Attachment failed. Reconnect to the same debug container.');
    pending.delete(key(record));
    publish({
      ...observed.record,
      state: observed.record.state === 'disconnected' ? 'running' : observed.record.state,
      message: `${observed.record.message} Terminal opened; stream state is independent of container state.`,
    });
  } catch (error) {
    pending.delete(key(record));
    let current = records.get(`${key(record)}:${record.containerName}`) ?? observed.record;
    let refreshed = false;
    try {
      current = (await inspectDebugRecord(current)).record;
      refreshed = true;
    } catch {
      current = records.get(`${key(record)}:${record.containerName}`) ?? current;
    }
    if (
      ['stale', 'terminated', 'rejected'].includes(current.state) ||
      (refreshed && current.state === 'waiting')
    )
      throw new Error(current.message, { cause: error });
    const parsed = parseAppError(error);
    publish({ ...current, state: 'disconnected', message: `${parsed.title}: ${parsed.detail}` });
    throw error;
  }
}
export async function startDebugSession(
  input: StartDebugInput,
  template: DebugTemplate,
  deps: Pick<DrawerActionDeps, 'executeAction' | 'createExecSession'>,
  elevatedAcknowledged = false,
  volumeMounts: { name: string; mountPath: string; readOnly: true }[] = [],
): Promise<void> {
  const guard = key(input);
  if (pending.has(guard))
    throw new Error(
      'A debug creation request is pending or unconfirmed. Inspect its status first.',
    );
  if (
    input.resourceData.metadata?.uid !== input.podUID ||
    !runningDebugTargets(input.resourceData).includes(input.targetContainerName)
  )
    throw new Error('Pod identity or target is no longer available');
  if (template.profile !== 'restricted' && !elevatedAcknowledged)
    throw new Error('Elevated access requires explicit confirmation');
  pending.add(guard);
  const { resourceData: _pod, ...identity } = input;
  let record: DebugRecord = {
    ...identity,
    containerName: `debugger-omniview-${crypto.randomUUID().slice(0, 12)}`,
    image: template.image,
    state: 'creating',
    certainty: 'unknown',
    message: 'Submitting debug container addition.',
  };
  record.expectedEntry = {
    name: record.containerName,
    image: template.image,
    command: [...template.command],
    imagePullPolicy: template.imagePullPolicy,
    stdin: true,
    tty: true,
    targetContainerName: input.targetContainerName,
    securityContext:
      template.profile === 'sysadmin'
        ? { privileged: true }
        : {
            runAsUser: 1000,
            runAsNonRoot: true,
            allowPrivilegeEscalation: false,
            capabilities: {
              drop: ['ALL'],
              ...(template.profile === 'netadmin' ? { add: ['NET_ADMIN', 'NET_RAW'] } : {}),
            },
            seccompProfile: { type: 'RuntimeDefault' },
          },
    ...(Object.keys(template.env).length
      ? {
          env: Object.keys(template.env)
            .sort()
            // Kubernetes omits empty env values when serializing the Pod.
            .map((name) => ({ name, value: template.env[name] || undefined })),
        }
      : {}),
    ...(volumeMounts.length ? { volumeMounts } : {}),
  };
  publish(record);
  let explicitRejection = false;
  try {
    const response = await deps.executeAction({
      actionID: 'debug-create',
      id: input.resourceID,
      namespace: input.namespace,
      params: {
        podUID: input.podUID,
        name: record.containerName,
        targetContainerName: input.targetContainerName,
        image: template.image,
        command: template.command,
        profile: template.profile,
        elevatedAcknowledged,
        imagePullPolicy: template.imagePullPolicy,
        env: template.env,
        volumeMounts,
      },
    });
    if (response?.success === false) {
      explicitRejection = true;
      throw new Error('Debug creation rejected. Review the request before retrying.');
    }
    if (response?.success !== true)
      throw new Error('DEBUG_CREATION_UNKNOWN: response did not confirm acceptance');
    const data = response.data as
      | { pod?: Pod; podUID?: string; containerName?: string }
      | undefined;
    if (
      data?.podUID !== input.podUID ||
      data?.containerName !== record.containerName ||
      !data.pod?.metadata?.uid
    )
      throw new Error(
        'DEBUG_CREATION_UNKNOWN: response did not establish the reserved container identity',
      );
    record = observeDebugRecord({ ...record, certainty: 'accepted', state: 'waiting' }, data.pod);
    publish(record);
  } catch (error) {
    const parsed = parseAppError(error);
    const message = explicitRejection
      ? 'Debug creation rejected. Review the request before retrying.'
      : `${parsed.title}: ${parsed.detail}`;
    // Only authoritative rejection establishes absence. Transport failures stay guarded.
    const uncertain =
      parsed.code === 'TIMEOUT' ||
      parsed.code === 'CANCELLED' ||
      parsed.status === 408 ||
      parsed.status === 499;
    const rejected =
      explicitRejection ||
      (!uncertain &&
        ([
          'INVALID_REQUEST',
          'UNSUPPORTED',
          'FORBIDDEN',
          'UNAUTHORIZED',
          'NOT_FOUND',
          'CONFLICT',
          'ALREADY_EXISTS',
          'RESOURCE_LIMIT',
        ].includes(parsed.code ?? '') ||
          [400, 401, 403, 404, 405, 409, 413, 415, 422, 429].includes(parsed.status)));
    publish({
      ...record,
      state: rejected ? 'rejected' : 'unknown',
      certainty: rejected ? 'rejected' : 'unknown',
      message,
    });
    if (rejected) pending.delete(guard);
    throw error;
  }
  await reconnectDebug(record, deps);
}
