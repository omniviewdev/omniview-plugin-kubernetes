import type { IconName, KindTileTone } from '@omniviewdev/kit';

// What the plugin says of its landing outside the pages themselves: their ids, the plugin's tile and how much of the connections the home page lists. They live apart from the pages (`pages.ts`, which holds the
// components) because a page links to the other by its id and the pages are what draw the links, and the sidebar's navigator opens them by it: this file imports none of them.

/** The id of the plugin's home page: the key of `contributionV1.pages` that `landing` names, which is the page the window opens when the plugin is opened and no connection is named. */
export const LANDING_PAGE = 'landing';

/** The id of the page of all the connections: the home page links to it, and the sidebar's navigator opens it with the state filter and the facets it is given (`place.ts`). */
export const CONNECTIONS_PAGE = 'connections';

/** Whether a page is one of the landing's: both are read in no connection, which is what says the sidebar for them is the navigator and not the tree of the resources of a connection. */
export const isLandingPage = (page: string): boolean => page === LANDING_PAGE || page === CONNECTIONS_PAGE;

/** What the plugin is called on its home page and on the tab of it. */
export const PLUGIN_TITLE = 'Kubernetes';

/** The tile of the home page: the mock's glyph for the plugin (`LuShip`, MOCK k8s-connections.js:621) in the plugin's accent. */
export const LANDING_TILE = { icon: 'ship', tone: 'blue' } as const satisfies { readonly icon: IconName; readonly tone: KindTileTone };

/** How many connections the home page lists before it links to the rest (the mock's `limit`, k8s-connections.js:873). */
export const HOME_LIMIT = 8;

/** What the pages say while the host has not yet read the connections, when it could not, and when the plugin has none (the mock's empty state of `renderHome`: `No connections found`). */
export const READING_WORDS = 'Reading connections…';
export const FAILED_WORDS = 'The connections could not be read.';
export const NONE_TITLE = 'No connections found';
export const NONE_HINT = 'Kubernetes reads them from your kubeconfig files.';
