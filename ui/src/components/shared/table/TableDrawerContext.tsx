import type { DrawerComponent, HostRecord } from '@omniviewdev/runtime';
import { createContext, useContext } from 'react';

/**
 * Provides the DrawerComponent (with its actions array) to table cells.
 * This lets ActionsCell read the drawer's actions without threading
 * the drawer through the column definition system.
 *
 * The value changes only with the drawer itself, never with the collection, so row cells may
 * read it without rendering again for every update.
 */
export const TableDrawerContext = createContext<{ drawer?: DrawerComponent } | undefined>(undefined);

export function useTableDrawer() {
  return useContext(TableDrawerContext);
}

/**
 * The admitted records of the current collection snapshot, by presentation body. Every snapshot
 * brings a new map, so only the single open row menu may read it: a row cell that did would
 * render again for each update, whether or not its own row changed.
 */
export const TableRecordsContext = createContext<WeakMap<object, HostRecord> | undefined>(undefined);

export function useTableRecords() {
  return useContext(TableRecordsContext);
}
