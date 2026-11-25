import { useMenu, type MenuItem } from '@omniviewdev/kit';
import { useConnections, type Connection } from '@omniviewdev/runtime/ui/v1';
import { useState } from 'react';

import type { ConnectionsHostV1 } from '../contract/v1';

import { copyText } from './clipboard';
import type { ConnectionRow } from './model';

// What both pages of the landing do the same way: read the plugin's own list of its connections, read the host's again, and offer one connection's menu.

/** The plugin's own list of its connections: what its other pages read them by (`connection.ts`), with the labels and the names the host's list does not carry. Undefined until it has answered. */
export function useKnownConnections(plugin: string): readonly Connection[] | undefined {
  return useConnections({ plugin }).connections.data;
}

/** The page's Refresh: it reads the host's list again (`context.connections.refresh`, which never rejects) and says while it does. */
export function useRefresh(connections: ConnectionsHostV1): { readonly refreshing: boolean; readonly refresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void connections.refresh().finally(() => {
      setRefreshing(false);
    });
  };
  return { refreshing, refresh };
}

/** The items of the menu of one connection. Opening goes through the host, which starts the connection first when it is not connected. */
function itemsOf(connections: ConnectionsHostV1, row: ConnectionRow): readonly MenuItem[] {
  return [
    {
      kind: 'action',
      id: 'open',
      label: 'Open',
      onSelect: () => {
        void connections.open(row.key);
      },
    },
    {
      kind: 'action',
      id: 'open-new',
      label: 'Open in new tab',
      onSelect: () => {
        void connections.open(row.key, { newTab: true });
      },
    },
    { kind: 'separator', id: 'copy-separator' },
    {
      kind: 'action',
      id: 'copy-name',
      label: 'Copy name',
      onSelect: () => {
        void copyText(row.name);
      },
    },
  ];
}

/**
 * The page's one menu: defined once with the kit's `useMenu` and made the context menu of every row and card by its key (`menuTrigger`, the table's `rowMenu`, a card's `menu`). The host's menu resolves the key
 * when it opens, against the rows as they are then, so the items are the connection's own; a connection that is gone has none.
 */
export function useConnectionMenu(connections: ConnectionsHostV1, rows: readonly ConnectionRow[]): string {
  return useMenu((key) => {
    const row = key === undefined ? undefined : rows.find((candidate) => candidate.key === key);
    return row === undefined ? undefined : itemsOf(connections, row);
  });
}
