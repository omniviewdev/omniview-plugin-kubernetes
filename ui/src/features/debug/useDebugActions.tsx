import React from 'react';

import type { DrawerActionDeps, StartDebugInput } from '../../components/shared/drawer/actionDeps';

import { startDebugSession } from './controller';
import DebugLaunchDialog from './DebugLaunchDialog';
import { DebugPreferencesDialog } from './DebugPreferencesDialog';
import { useDebugPreferences } from './useDebugPreferences';

export function useDebugActions(
  connectionID: string,
  deps: Pick<DrawerActionDeps, 'executeAction' | 'createExecSession'>,
) {
  const preferences = useDebugPreferences(connectionID);
  const [launch, setLaunch] = React.useState<StartDebugInput | null>(null);
  const [settings, setSettings] = React.useState(false);
  const startDebug = React.useCallback(
    async (input: StartDebugInput) => {
      if (preferences.isLoading) throw new Error('Debug preferences are loading');
      if (preferences.error) throw new Error(String(preferences.error));
      if (preferences.resolved.issues.length) {
        setLaunch(input);
        return;
      }
      if (preferences.resolved.requiresElevationConfirmation) {
        setLaunch(input);
        return;
      }
      await startDebugSession(input, preferences.resolved.template, deps);
    },
    [preferences, deps],
  );
  const dialogs = (
    <>
      {launch && (
        <DebugLaunchDialog
          open={!settings}
          input={launch}
          templates={preferences.templates}
          initial={preferences.resolved.template}
          warnings={preferences.resolved.issues.map((issue) => issue.message).join(' ')}
          onClose={() => setLaunch(null)}
          onSettings={() => setSettings(true)}
          onLaunch={(template, acknowledged, mounts) => {
            if (preferences.isLoading)
              return Promise.reject(new Error('Debug preferences are loading or saving'));
            if (preferences.error) return Promise.reject(new Error(preferences.error));
            return startDebugSession(launch, template, deps, acknowledged, mounts);
          }}
        />
      )}
      <DebugPreferencesDialog
        open={settings}
        connectionID={connectionID}
        onClose={() => setSettings(false)}
      />
    </>
  );
  return {
    startDebug,
    openDebugOptions: setLaunch,
    dialogs,
    isReady: !preferences.isLoading,
    isBusy: Boolean(launch || settings),
  };
}
