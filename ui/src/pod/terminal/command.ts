import type { PageHeaderCommand, PageHeaderMenuItem, PageOperation } from '@omniviewdev/kit';
import { extensionRootOf } from '@omniviewdev/runtime/ui/v1';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { PanelHostV1 } from '../../contract/v1';
import type { LocatedObject } from '../../extensions/object';
import { podDefinition } from '../../kinds/pods/definition';
import { podDetail } from '../data/object';

import { runningContainers, type RunningContainer } from './containers';

export type PodShellCommand = {
  readonly button: PageHeaderCommand;
  readonly entries: readonly PageHeaderMenuItem[];
  readonly operation?: PageOperation;
};

/** No Pod shell without the original attested record. A multi-container Pod gets explicit menu choices. */
export function usePodShell(
  terminal: PanelHostV1['terminal'],
  object: LocatedObject | undefined,
): PodShellCommand {
  'use no memo'; // Re-read the host witness on every source render even if Kubernetes' record is unchanged.
  const record = object?.record;
  const witness = terminal && record ? extensionRootOf?.(record) : undefined;
  const lease = useMemo(() => ({ terminal, record, witness }), [terminal, record, witness]);
  const active = useRef<typeof lease | undefined>(undefined);
  const [failed, setFailed] = useState<typeof lease>();
  useLayoutEffect(() => {
    active.current = lease;
    return () => {
      active.current = undefined;
    };
  }, [lease]);

  const pod = witness && record ? podDetail(record) : undefined;
  const targets = useMemo(() => (pod ? runningContainers(pod) : []), [pod]);
  const sole = pod?.spec.containers?.length === 1 ? targets[0] : undefined;
  const disabledReason = !terminal
    ? 'This version of Omniview cannot open a Pod shell.'
    : !witness
      ? 'Shell needs a verified, current Pod in this connection.'
      : targets.length === 0
        ? 'This Pod has no verified running container.'
        : !sole
          ? 'Choose a container in the Pod menu to open a shell.'
          : undefined;

  function open(target: RunningContainer) {
    // A stale button, an unmounted page, or an invalidated native witness cannot start a session.
    if (
      active.current !== lease ||
      !record ||
      !terminal ||
      !witness ||
      extensionRootOf?.(record) !== witness
    )
      return;
    const { address } = record.record.reference;
    const namespace = address.scope[0]?.value;
    if (!namespace) return;
    setFailed(undefined);
    const failedOpen = () => {
      if (active.current === lease) setFailed(lease);
    };
    try {
      void terminal
        .open({
          record,
          route: {
            page: podDefinition.detail.page,
            params: { namespace, name: address.id, ...target },
          },
          params: target,
        })
        .catch(failedOpen);
    } catch {
      failedOpen();
    }
  }

  return {
    button: {
      id: 'shell',
      label: 'Shell',
      onSelect: () => {
        if (!disabledReason && sole) open(sole);
      },
      ...(disabledReason ? { disabledReason } : {}),
    },
    entries:
      !terminal || sole
        ? []
        : targets.map((target) => ({
            id: `shell:${target.container}`,
            label: `Open shell in ${target.container}`,
            onSelect: () => open(target),
          })),
    ...(failed === lease
      ? {
          operation: {
            state: 'failed',
            title: 'Open shell',
            text: 'The host could not open a shell for this Pod and container.',
            onDismiss: () => setFailed(undefined),
          },
        }
      : {}),
  };
}
