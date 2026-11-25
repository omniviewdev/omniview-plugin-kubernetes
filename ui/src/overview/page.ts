import type { OverviewPageV1 } from '../contract/v1';

import { OVERVIEW_TILE } from './entry';
import { useOverviewPage } from './useOverviewPage';

// The cluster overview as the plugin contributes it (`contributionV1.pages.overview`): the page a connection opens on (`home`) and its first entry in the sidebar. It is the mock's Overview (`k8s-cluster.js`): the
// page of a connection, which the host draws with its detail page (the header with the connection's name, the chip, the facts, the page's own Refresh, the tab strip, the Overview's summary and sections), from this
// static definition, which it can draw before any data is read, and the one data hook (`useOverviewPage.ts`). It has no identity and no list: it is the page of a scope and not of an object, so the window opens it
// with no object and its tab is the connection's. Its one tab is the mock's Overview; the Metrics tab is not built, because no metrics are served to the UI.
export const overviewPage = {
  kind: 'overview',
  definition: {
    title: 'Overview',
    tile: OVERVIEW_TILE,
    tabs: [{ id: 'overview', label: 'Overview' }],
  },
  usePage: useOverviewPage,
} satisfies OverviewPageV1;
