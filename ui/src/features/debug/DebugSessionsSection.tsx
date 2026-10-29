import React from 'react';
import {
  Button,
  Card,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Stack,
  Text,
} from '@omniviewdev/base-ui';
import { parseAppError, useExec } from '@omniviewdev/runtime';
import type { Pod } from 'kubernetes-types/core/v1';
import {
  getDebugRecords,
  subscribeDebugRecords,
  inspectDebugRecord,
  reconnectDebug,
  observeDebugRecord,
  syncDebugPodRecords,
  type DebugRecord,
} from './controller';

function formatSessionError(cause: unknown): string {
  const error = parseAppError(cause);
  if (error.code) return `${error.title}: ${error.detail}`;
  return cause instanceof Error ? cause.message : error.detail;
}

export default function DebugSessionsSection({
  connectionID,
  pod,
}: {
  connectionID: string;
  pod: Pod;
}) {
  const records = React.useSyncExternalStore(subscribeDebugRecords, getDebugRecords);
  const { createSession } = useExec({ pluginID: 'kubernetes' });
  const [error, setError] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const detailsID = React.useId();
  const lastPodObservation = React.useRef<{
    connectionID: string;
    podUID: string | undefined;
    resourceVersion: string | undefined;
    pod: Pod;
  } | null>(null);
  const podUID = pod.metadata?.uid;
  const resourceVersion = pod.metadata?.resourceVersion;
  const runSessionAction = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(formatSessionError(cause));
    }
  };
  const local = records.filter(
    (record) =>
      record.connectionID === connectionID &&
      record.resourceID === pod.metadata?.name &&
      record.namespace === pod.metadata?.namespace,
  );
  const known = new Set(
    local
      .filter((record) => record.podUID === pod.metadata?.uid)
      .map((record) => record.containerName),
  );
  const observed: DebugRecord[] = (pod.spec?.ephemeralContainers ?? [])
    .filter((container) => !known.has(container.name))
    .map((container) =>
      observeDebugRecord(
        {
          connectionID,
          resourceID: pod.metadata!.name!,
          namespace: pod.metadata!.namespace!,
          podUID: pod.metadata!.uid!,
          containerName: container.name,
          targetContainerName: container.targetContainerName ?? 'unknown',
          image: container.image ?? '',
          certainty: 'accepted',
          state: 'waiting',
          message: 'Observed ephemeral container',
        },
        pod,
      ),
    );
  const all = [...local, ...observed];
  React.useEffect(() => {
    const previous = lastPodObservation.current;
    // A cached drawer snapshot must not overwrite a newer explicit status read.
    if (
      previous?.connectionID === connectionID &&
      previous.podUID === podUID &&
      (resourceVersion ? previous.resourceVersion === resourceVersion : previous.pod === pod)
    )
      return;
    lastPodObservation.current = { connectionID, podUID, resourceVersion, pod };
    syncDebugPodRecords(connectionID, pod);
  }, [connectionID, pod, podUID, resourceVersion]);
  React.useEffect(() => {
    const active = local.filter((record) =>
      ['creating', 'unknown', 'waiting'].includes(record.state),
    );
    if (!active.length) return;
    let cancelled = false;
    const timer = setInterval(() => {
      for (const record of active) {
        if (!cancelled)
          void inspectDebugRecord(record).catch((cause) => {
            if (!cancelled) setError(formatSessionError(cause));
          });
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [records, connectionID, pod.metadata?.uid]);
  if (!all.length) return null;
  return (
    <section aria-label="Debug sessions">
      <Stack direction="column" spacing={2}>
        <Text role="heading" aria-level={3} size="sm" weight="semibold">
          Debug sessions
        </Text>
        {error && (
          <Text role="alert" size="sm">
            {error}
          </Text>
        )}
        {all.map((record) => {
          const key = `${record.podUID}:${record.containerName}`;
          const open = expanded[key] ?? false;
          const contentID = `${detailsID}-${key}`;
          return (
            <Card as="article" size="sm" key={key}>
              <Card.Body>
                <Stack direction="column" spacing={2}>
                  <Text size="sm" weight="semibold">
                    {record.containerName}
                  </Text>
                  <Text size="sm">
                    {record.state} · {record.message}
                  </Text>
                  <Collapsible
                    open={open}
                    onOpenChange={(next) => setExpanded((current) => ({ ...current, [key]: next }))}
                  >
                    <CollapsibleTrigger aria-controls={contentID}>
                      Session details
                    </CollapsibleTrigger>
                    <CollapsibleContent id={contentID} inert={!open} aria-hidden={!open}>
                      <dl>
                        <dt>Target</dt>
                        <dd>{record.targetContainerName}</dd>
                        <dt>Image</dt>
                        <dd>{record.image}</dd>
                        <dt>Original Pod UID</dt>
                        <dd>{record.podUID}</dd>
                        <dt>Creation</dt>
                        <dd>{record.certainty}</dd>
                      </dl>
                      <Text as="p" size="sm">
                        Pod network is shared. Process visibility is runtime-dependent. Toolbox root
                        and environment remain separate. Closing a terminal does not remove an
                        ephemeral container.
                      </Text>
                    </CollapsibleContent>
                  </Collapsible>
                  <Stack direction="row" spacing={2}>
                    {!['stale', 'terminated', 'rejected'].includes(record.state) && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          void runSessionAction(() => inspectDebugRecord(record));
                        }}
                      >
                        Inspect status
                      </Button>
                    )}
                    {record.certainty === 'accepted' &&
                      ['running', 'disconnected'].includes(record.state) && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            void runSessionAction(() =>
                              reconnectDebug(record, { createExecSession: createSession }),
                            );
                          }}
                        >
                          Reconnect
                        </Button>
                      )}
                  </Stack>
                </Stack>
              </Card.Body>
            </Card>
          );
        })}
      </Stack>
    </section>
  );
}
