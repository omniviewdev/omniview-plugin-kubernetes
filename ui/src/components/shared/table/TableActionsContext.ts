import type {
  ActivityRecord,
  NotificationOptions,
  RightDrawerContextType,
} from '@omniviewdev/runtime';
import { createContext, useContext } from 'react';

/**
 * Host actions that table rows and cells call from event handlers.
 *
 * The host contexts behind them change with the drawer's open state and with every activity, so
 * a row that read them directly would render again for each of those changes. `TableActionsScope`
 * reads them once for the whole table and hands every row the same forwarding functions, which
 * always call the host's latest callbacks.
 */
export type TableActions = {
  openDrawer: RightDrawerContextType['openDrawer'];
  showResourceSidebar: RightDrawerContextType['showResourceSidebar'];
  notify: (options: NotificationOptions) => Promise<ActivityRecord | undefined>;
};

export const TableActionsContext = createContext<TableActions | undefined>(undefined);

export function useTableActions(): TableActions {
  const actions = useContext(TableActionsContext);
  if (!actions) throw new Error('Table actions require TableActionsScope.');
  return actions;
}
