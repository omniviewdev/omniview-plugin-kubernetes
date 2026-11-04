import {
  usePluginContext,
  useConnection,
  useSnackbar,
  usePluginRouter,
} from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';
import { useCallback, useRef, useState } from 'react';

/** Connection actions navigate only; the mounted ready route owns recent history. */
export function useClusterAction(connectionId: string, isConnected: boolean) {
  const { meta } = usePluginContext();
  const { navigate } = usePluginRouter();
  const snackbar = useSnackbar();
  const { startConnection, stopConnection } = useConnection({
    pluginID: meta.id,
    connectionID: connectionId,
    enabled: false,
  });
  const [connecting, setConnecting] = useState(false);
  const pending = useRef(false);
  const run = useCallback(
    async (open: boolean) => {
      if (pending.current) return;
      pending.current = true;
      setConnecting(true);
      try {
        if (!isConnected) {
          const status = await startConnection();
          if (status.status !== types.ConnectionStatusCode.ConnectionStatusConnected) {
            snackbar.showSnackbar({
              status: 'warning',
              message: 'Failed to connect to cluster',
              details: status.details,
              icon: 'LuCircleAlert',
            });
            return;
          }
        }
        if (open) {
          navigate(`/cluster/${encodeURIComponent(connectionId)}/resources`);
        }
      } catch {
        // Lifecycle failures already report structured details through useConnection.
      } finally {
        pending.current = false;
        setConnecting(false);
      }
    },
    [connectionId, isConnected, navigate, snackbar, startConnection],
  );
  const handleClick = useCallback(() => run(true), [run]);
  const handleConnect = useCallback(() => run(false), [run]);
  const handleDisconnect = useCallback(async () => {
    try {
      await stopConnection();
    } catch {
      /* useConnection reports lifecycle failures. */
    }
  }, [stopConnection]);
  return { handleClick, handleConnect, handleDisconnect, connecting };
}
