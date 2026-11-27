import { terminalActions } from '@omniviewdev/kubernetes-extension-points';
import { menuOutlet } from '@omniviewdev/runtime/ui/extensions/v1';
import { extensionRootOf } from '@omniviewdev/runtime/ui/v1';

import type { TerminalMenuOriginV1, TerminalMenuOutletV1 } from '../../contract/v1';
import { locateObject, managedBy } from '../../extensions/object';
import { useKindObject } from '../../kinds/detail/useKindObject';
import { podDefinition } from '../../kinds/pods/definition';
import { podDetail } from '../data/object';

import { runningContainers } from './containers';

const terminalFields = [
  'namespace',
  'name',
  'container',
  'containerID',
  'containerRestart',
] as const;

/** Called by the host for the hit terminal, not the active document. Invalid origins initiate no Pod read. */
export function usePodTerminalMenu(origin: TerminalMenuOriginV1): TerminalMenuOutletV1 | undefined {
  'use no memo'; // A reset can retire provenance before a new record arrives. Never reuse the last eligibility answer.
  const { surface, route, connection, extensionScopeKey } = origin;
  const { namespace, name, container, containerID, containerRestart } = route.params;
  const supported =
    surface === 'terminal-body' &&
    route.page === podDefinition.detail.page &&
    connection &&
    extensionScopeKey &&
    extensionScopeKey.length <= 256 &&
    namespace &&
    name &&
    container &&
    containerID &&
    containerID.length <= 256 &&
    /^(?:0|[1-9]\d{0,9})$/.test(containerRestart ?? '') &&
    Object.keys(route.params).length === terminalFields.length &&
    terminalFields.every((key) => Object.hasOwn(route.params, key));
  const { currentRecord } = useKindObject(podDefinition, {
    connectionID: supported ? connection : undefined,
    namespace,
    name: name ?? '',
  });
  if (!supported || !currentRecord) return;
  const extensionRoot = extensionRootOf?.(currentRecord);
  if (!extensionRoot) return;
  const object = locateObject(
    currentRecord,
    connection,
    namespace,
    name,
    podDefinition.type,
    podDefinition.kind,
  );
  if (
    !object ||
    object.uid !== extensionScopeKey ||
    !runningContainers(podDetail(currentRecord)).some(
      (target) =>
        target.container === container &&
        target.containerID === containerID &&
        target.containerRestart === containerRestart,
    )
  )
    return;
  const manager = managedBy(object.metadata);
  return {
    extensionScopeKey: object.uid,
    extensionRoot,
    outlet: menuOutlet(terminalActions, {
      kind: object.kind,
      ...(manager === undefined ? {} : { managedBy: manager }),
    }),
  };
}
