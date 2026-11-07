import { Spinner } from '@omniviewdev/base-ui';
import { useConnections } from '@omniviewdev/runtime';
import type { ReactNode } from 'react';

import { useLegacyColumnMigration } from '../../hooks/useLegacyColumnMigration';
import { PLUGIN_ID } from '../../pluginId';

/** Run provider-owned preference migration before any resource table reads its state. */
export function PreferenceMigrationGate({ children }: { children: ReactNode }) {
  const { connections } = useConnections({ plugin: PLUGIN_ID });
  const ready = useLegacyColumnMigration(connections.data?.map(connection => connection.id));
  return ready ? children : <div role="status"><Spinner size="sm" />Restoring column preferences...</div>;
}
