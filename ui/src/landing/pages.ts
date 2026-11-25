import type { CustomPageV1 } from '../contract/v1';

import { CONNECTIONS_PAGE, LANDING_PAGE, LANDING_TILE, PLUGIN_TITLE } from './entry';
import { Home } from './home';
import { ConnectionsList } from './list';

// The plugin's landing as it contributes it: two custom pages that are read in no connection and drawn by the plugin from the kit's parts. The home page is the one the window opens when the plugin is opened and no
// connection is chosen (`contributionV1.landing`), and the page of all the connections is one link from it. A connection that is chosen opens `home`, the cluster Overview, as it always did.

/** The home page: the plugin's header and its connections. A document, as a page of a header and a section is: the page scrolls. */
export const landingPage = { kind: 'custom', scope: 'plugin', title: PLUGIN_TITLE, icon: LANDING_TILE.icon, Body: Home } satisfies CustomPageV1;

/** The page of all the connections. It owns its scrolling, as a data view does: its header, strip and toolbar stay and its rows scroll. */
export const connectionsPage = { kind: 'custom', scope: 'plugin', title: 'Connections', icon: 'server', layout: 'pane', Body: ConnectionsList } satisfies CustomPageV1;

/** The landing's pages by their ids, for the contribution's `pages`. */
export const landingPages = { [LANDING_PAGE]: landingPage, [CONNECTIONS_PAGE]: connectionsPage };
