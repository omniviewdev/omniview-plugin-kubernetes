import type { DrawerComponent } from '@omniviewdev/runtime';
import { createContext, useContext } from 'react';

/**
 * Provides the DrawerComponent (with its actions array) to table cells.
 * This lets ActionsCell read the drawer's actions without threading
 * the drawer through the column definition system.
 */
export const TableDrawerContext = createContext<DrawerComponent | undefined>(undefined);

export function useTableDrawer(): DrawerComponent | undefined {
  return useContext(TableDrawerContext);
}
