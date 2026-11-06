import { Spinner } from '@omniviewdev/base-ui';
import { useConnections, usePluginRouter, useNotifications } from '@omniviewdev/runtime';
import { useEffect, useRef } from 'react';
import { useParams } from 'react-router';

import ClusterConnectionBoundary from '../components/connections/ClusterConnectionBoundary';
import { useClusterPreferences } from '../hooks/useClusterPreferences';
import { useLegacyColumnMigration } from '../hooks/useLegacyColumnMigration';
import { PLUGIN_ID } from '../pluginId';
import ClusterResourcesPage from './ClusterResourcesPage';

/** Mounted only by ConnectionBoundary after native readiness confirms CONNECTED.
 * The resource parent route survives nested navigation; reconnect remounts this session.
 */
export function ConnectedClusterView({ connectionID }: { connectionID: string }) {
  const preferences = useClusterPreferences(PLUGIN_ID);
  const { notify } = useNotifications();
  const recordedID = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (recordedID.current === connectionID) return;
    recordedID.current = connectionID;
    // A failed preference write must not turn a successful view into a failed connection.
    void preferences.recordAccess(connectionID).catch(() => {
      void notify({
        severity: 'warning',
        title: 'Cluster opened, but recent history could not be saved.',
      });
    });
  }, [connectionID, preferences, notify]);
  return <ClusterResourcesPage />;
}

export default function ClusterResourcesRoute() {
  const { id = '' } = useParams<{ id: string }>();
  const { navigate } = usePluginRouter();
  const { connections } = useConnections({ plugin: PLUGIN_ID });
  const migrationReady = useLegacyColumnMigration(connections.data?.map(connection => connection.id));
  return (
    <ClusterConnectionBoundary
      connectionID={id}
      onEditConnection={() => navigate(`/cluster/${encodeURIComponent(id)}/edit`)}
      onBack={() => navigate('/clusters')}
    >
      {migrationReady
        ? <ConnectedClusterView connectionID={id} />
        : <div role="status"><Spinner size="sm" />Restoring column preferences...</div>}
    </ClusterConnectionBoundary>
  );
}
