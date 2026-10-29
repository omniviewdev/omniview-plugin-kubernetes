import { ConnectionBoundary, ConnectionBoundaryFallback, useConnection, usePluginData } from '@omniviewdev/runtime';
import type { ReactNode } from 'react';

import type { ConnectionOverride } from '../../types/clusters';

import ClusterConnectionDetails from './ClusterConnectionDetails';

const EMPTY_OVERRIDES: Record<string, ConnectionOverride> = {};

interface Props {
  connectionID: string;
  children: ReactNode;
  onEditConnection?: () => void;
  onBack?: () => void;
}

/** Keep cluster resource hooks unmounted until their connection is ready. */
export default function ClusterConnectionBoundary({ connectionID, children, onEditConnection, onBack }: Props) {
  const { connection } = useConnection({ pluginID: 'kubernetes', connectionID });
  const overrides = usePluginData<Record<string, ConnectionOverride>>('kubernetes', 'cluster_overrides', EMPTY_OVERRIDES);
  return (
    <ConnectionBoundary
      pluginID="kubernetes"
      connectionID={connectionID}
      fallback={(state) => (
        <ConnectionBoundaryFallback
          state={state}
          onEditConnection={onEditConnection}
          onBack={onBack}
          connectionDetails={
            <ClusterConnectionDetails
              connectionID={connectionID}
              connection={connection.data}
              override={overrides.data?.[connectionID]}
              isLoading={connection.isLoading}
              metadataError={connection.isError}
            />
          }
        />
      )}
    >
      {children}
    </ConnectionBoundary>
  );
}
