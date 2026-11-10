import { useNotifications, useRightDrawer } from '@omniviewdev/runtime';
import React from 'react';

import { TableActionsContext, type TableActions } from './TableActionsContext';

/** Reads the host's drawer and activity contexts once and shares stable actions; see `TableActions`. */
export function TableActionsScope({ children }: React.PropsWithChildren) {
  const drawer = useRightDrawer();
  const { notify } = useNotifications();
  const latest = React.useRef({ drawer, notify });
  React.useLayoutEffect(() => {
    latest.current = { drawer, notify };
  }, [drawer, notify]);
  const actions = React.useMemo<TableActions>(
    () => ({
      openDrawer: (component, ctx) => latest.current.drawer.openDrawer(component, ctx),
      showResourceSidebar: (params) => latest.current.drawer.showResourceSidebar(params),
      notify: (options) => latest.current.notify(options),
    }),
    [],
  );
  return <TableActionsContext.Provider value={actions}>{children}</TableActionsContext.Provider>;
}
