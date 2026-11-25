import type { IconName, KindTileTone } from '@omniviewdev/kit';

import type { SidebarNodeV1 } from '../contract/v1';

// What the plugin says of its overview page outside the page itself: its id, its glyph and its entry in the sidebar. They live apart from the page (`page.ts`, which holds its data hook and so the registry of
// the kinds) because the registry builds the sidebar and needs the entry, and the page needs the registry: this file imports neither.

/** The id of the overview page: the key of `contributionV1.pages`, the id of its sidebar entry, and the page the window opens first (`home`). */
export const OVERVIEW_PAGE = 'overview';

/**
 * The tile of the page: the glyph before its name in the header, the tab and the sidebar. The mock's is `LuLayoutDashboard` (k8s-cluster.js:21, shell-kubernetes.js:366), which the kit's registry has no glyph
 * for; the nearest it has is `layout-template`, blocks laid out as a page is. It is the mock's glyph of the PodTemplate kind, which this plugin lists no kind for, so no tile of a kind says another
 * kind (`kinds/index.test.ts` holds that); when the kit has `layout-dashboard` this names it.
 */
export const OVERVIEW_TILE = { icon: 'layout-template', tone: 'blue' } as const satisfies { readonly icon: IconName; readonly tone: KindTileTone };

/**
 * The first entry of the sidebar, above Nodes (the mock's top level begins with Overview: shell-kubernetes.js:366). It has no count: it is a page of the connection and not a kind, so it declares no count
 * slot (`kinds/index.ts` declares one on every entry of a kind). Its keywords are the mock's (`cluster summary health`).
 */
export const OVERVIEW_ENTRY: SidebarNodeV1 = { id: OVERVIEW_PAGE, label: 'Overview', icon: OVERVIEW_TILE.icon, keywords: ['cluster', 'summary', 'health'] };
