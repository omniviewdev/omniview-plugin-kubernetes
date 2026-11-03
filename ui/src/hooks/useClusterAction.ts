import {
  usePluginContext,
  useConnection,
  useNotifications,
  usePluginRouter,
} from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';
import { useCallback } from 'react';

/**
 * Shared hook that handles connect-and-navigate for a cluster connection.
 * Replaces the HubCardHandler wrapper pattern.
 */
export function useClusterAction(
  connectionId: string,
  isConnected: boolean,
  onRecordAccess: () => void,
) {
  const { meta } = usePluginContext();
  const { navigate } = usePluginRouter();
   
  const { notify } = useNotifications();
  const { startConnection } = useConnection({
    pluginID: meta.id,
    connectionID: connectionId,
  });

  const handleClick = useCallback(() => {
    onRecordAccess();
    if (isConnected) {
      navigate(`/cluster/${encodeURIComponent(connectionId)}/resources`);
      return;
    }
    startConnection()
      .then((status) => {
        if (status.status === types.ConnectionStatusCode.ConnectionStatusConnected) {
          navigate(`/cluster/${encodeURIComponent(connectionId)}/resources`);
        } else {
          void notify({
            severity: 'warning',
            title: `Failed to connect to cluster`,
            details: status.details,
          });
        }
      })
      .catch((err) => {
        if (err instanceof Error) {
          void notify({ severity: 'error', title: err.message });
        }
      });
  }, [connectionId, isConnected, onRecordAccess, navigate, startConnection, notify]);

  return { handleClick };
}
