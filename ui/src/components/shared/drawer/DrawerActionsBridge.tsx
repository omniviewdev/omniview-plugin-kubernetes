import {
  useConfirmationModal,
  useExec,
  useExecuteAction,
  useLogs,
  useResourceMutations,
  useRightDrawer,
  useStreamAction,
} from '@omniviewdev/runtime';
import React from 'react';

import { useDebugActions } from '../../../features/debug/useDebugActions';
import { useClusterPreferences } from '../../../hooks/useClusterPreferences';
import ScaleModal from '../../kubernetes/actions/ScaleModal';

import { type DrawerActionDeps, registerDrawerActionDeps, registryKey, type ScaleTarget } from './actionDeps';

const PLUGIN_ID = 'kubernetes';

/** Mounts the hook-backed handlers that drawer actions use; see `actionDeps.ts`. */
type BridgeProps = {
  connectionID: string;
  resourceKey: string;
};

export const useDrawerActionExecution = ({ connectionID, resourceKey }: BridgeProps) => {
  const { show } = useConfirmationModal();
  const { remove, update } = useResourceMutations({ pluginID: PLUGIN_ID });
  const { createLogSession } = useLogs({ pluginID: PLUGIN_ID });
  const { createSession } = useExec({ pluginID: PLUGIN_ID });
  const { executeAction, isExecuting } = useExecuteAction({ pluginID: PLUGIN_ID, connectionID, resourceKey });
  const { startStreamAction } = useStreamAction({ pluginID: PLUGIN_ID, connectionID, resourceKey });
  const { closeDrawer } = useRightDrawer();
  const { connectionOverrides } = useClusterPreferences(PLUGIN_ID);
  const nodeShellConfig = connectionOverrides[connectionID]?.nodeShellConfig;
  const debugTransport = React.useMemo(() => ({ executeAction, createExecSession: createSession }), [executeAction, createSession]);
  const debug = useDebugActions(connectionID, debugTransport);

  const [scaleTarget, setScaleTarget] = React.useState<ScaleTarget | null>(null);

  const deps = React.useMemo<DrawerActionDeps>(
    () => ({
      show,
      remove,
      update,
      createLogSession,
      createExecSession: createSession,
      executeAction,
      startStreamAction,
      closeDrawer,
      openScale: setScaleTarget,
      nodeShellConfig,
      startDebug: debug.startDebug,
      openDebugOptions: debug.openDebugOptions,
    }),
    [show, remove, update, createLogSession, createSession, executeAction, startStreamAction, closeDrawer, nodeShellConfig, debug.startDebug, debug.openDebugOptions],
  );


  const dialogs = scaleTarget ? (
    <ScaleModal
      open
      onClose={() => setScaleTarget(null)}
      onConfirm={(replicas) => {
        void executeAction({
          actionID: 'scale',
          id: scaleTarget.name,
          namespace: scaleTarget.namespace,
          params: { replicas },
        }).then(() => {
          setScaleTarget(null);
          closeDrawer();
        });
      }}
      resourceType={resourceKey.split('::').pop() ?? resourceKey}
      resourceName={scaleTarget.name}
      currentReplicas={scaleTarget.replicas}
      isExecuting={isExecuting}
    />
  ) : null;
  return { deps, dialogs: <>{dialogs}{debug.dialogs}</>, isReady: debug.isReady, isBusy: scaleTarget !== null || isExecuting || debug.isBusy };
};

const DrawerActionsBridge: React.FC<BridgeProps> = (props) => {
  const { deps, dialogs } = useDrawerActionExecution(props);
  React.useEffect(
    () => registerDrawerActionDeps(registryKey(props.connectionID, props.resourceKey), deps),
    [props.connectionID, props.resourceKey, deps],
  );
  return dialogs;
};

export default DrawerActionsBridge;
