import {
  usePluginContext,
  useConnection,
  useSnackbar,
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
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { showSnackbar } = useSnackbar();
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
          showSnackbar({
            status: 'warning',
            message: `Failed to connect to cluster`,
            details: status.details,
            icon: 'LuCircleAlert',
          });
        }
      }, () => {
        // useConnection already reports lifecycle failures with structured details.
      });
  }, [connectionId, isConnected, onRecordAccess, navigate, startConnection, showSnackbar]);

  return { handleClick };
}
