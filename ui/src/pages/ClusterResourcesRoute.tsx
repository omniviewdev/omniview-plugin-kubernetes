import { usePluginRouter, useSnackbar } from '@omniviewdev/runtime';
import { useEffect, useRef } from 'react';
import { useParams } from 'react-router';

import ClusterConnectionBoundary from '../components/connections/ClusterConnectionBoundary';
import { useClusterPreferences } from '../hooks/useClusterPreferences';
import { PLUGIN_ID } from '../pluginId';
import ClusterResourcesPage from './ClusterResourcesPage';

/** Mounted only by ConnectionBoundary after native readiness confirms CONNECTED.
 * The resource parent route survives nested navigation; reconnect remounts this session.
 */
export function ConnectedClusterView({ connectionID }: { connectionID: string }) {
  const preferences = useClusterPreferences(PLUGIN_ID);
  const snackbar = useSnackbar();
  const recordedID = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (recordedID.current === connectionID) return;
    recordedID.current = connectionID;
    // A failed preference write must not turn a successful view into a failed connection.
    void preferences.recordAccess(connectionID).catch(() => {
      snackbar.showSnackbar({
        status: 'warning',
        message: 'Cluster opened, but recent history could not be saved.',
      });
    });
  }, [connectionID, preferences, snackbar]);
  return <ClusterResourcesPage />;
}

export default function ClusterResourcesRoute() {
  const { id = '' } = useParams<{ id: string }>();
  const { navigate } = usePluginRouter();
  return (
    <ClusterConnectionBoundary
      connectionID={id}
      onEditConnection={() => navigate(`/cluster/${encodeURIComponent(id)}/edit`)}
      onBack={() => navigate('/clusters')}
    >
      <ConnectedClusterView connectionID={id} />
    </ClusterConnectionBoundary>
  );
}
