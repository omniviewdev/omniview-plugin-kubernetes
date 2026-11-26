import type { ConnectionsViewV1, SidebarNodeV1 } from '../contract/v1';

import { CONNECTIONS_PAGE, LANDING_PAGE, PLUGIN_TITLE } from './entry';
import { hueOf } from './hue';
import { rowsOf, scopeCounts, type ConnectionRow, type Scope } from './model';
import { paramsOf, placeOf } from './place';

// What the plugin's sidebar is while one of the landing's two pages is on screen (the mock's `sidebar`, k8s-connections.js): the way back to the plugin's home, the state filters of the page of all the connections with
// how many connections each holds, and the connections themselves, each a leaf that opens that connection. The window draws no sidebar for a page that is read in no connection but the one the plugin's hook answers
// for it, so this is all there is; the folders, the saved views and the recent connections of the mock are not here, because the host has no data for them.

/** The ids of the entries. A leaf that opens a page with parameters has an id that is no page's key (a host that predates the members would else open that page without them). */
const ALL = 'connections-all';
const CONNECTED = 'connections-connected';
const ATTENTION = 'connections-attention';
const LIST = 'connection-list';

/** The state of a connection says it needs a look when the host gives it the role of a warning or an error: the badge says it in the host's word, and never by its colour alone. */
const needsLook = (row: Pick<ConnectionRow, 'role'>): boolean => row.role === 'attention' || row.role === 'error';

/** One connection: it opens that connection (the host starts it first), wears the hue its tile has on the pages, and says in the host's word where it stands when that needs a look. */
function leafOf(row: ConnectionRow): SidebarNodeV1 {
  return {
    id: `connection-${row.key}`,
    label: row.name,
    icon: 'server',
    tone: hueOf(row.name),
    connection: row.key,
    ...(needsLook(row) ? { status: { role: row.role, label: row.word } } : {}),
  };
}

/**
 * The navigator, from what the host says of the connections and the parameters of the page on screen (`route.params`). A state filter opens the page of all the connections with the parameter that says it (`place.ts`) and
 * the values of the facets the page has now, so that choosing one keeps the facets, and the entry that is selected is the one whose parameters are the page's: with a facet chosen it is still the entry of the state, and
 * never the plain entry of the page. The counts are of every connection, whatever the facets and the search leave, as the strip's are, and they are held (`null`) until the host has read the connections and not said when it
 * could not, so that no count is a zero that was not counted. The group of the connections starts open.
 */
export function navigatorOf(view: ConnectionsViewV1, params: Readonly<Record<string, string>>): readonly SidebarNodeV1[] {
  const rows = rowsOf(view.connections);
  const here = placeOf(params);
  const counted = view.loaded && (!view.failed || rows.length > 0);
  const counts = scopeCounts(rows);
  const count = (n: number): number | null => (counted ? n : null);
  const opening = (scope: Scope | null): Pick<SidebarNodeV1, 'page' | 'params'> => ({ page: CONNECTIONS_PAGE, params: paramsOf({ ...here, scope }) });

  return [
    { id: LANDING_PAGE, label: PLUGIN_TITLE, icon: 'boxes' },
    { id: ALL, label: 'All connections', icon: 'server', count: count(rows.length), ...opening(null) },
    { id: CONNECTED, label: 'Connected', icon: 'plug', count: count(counts.connected), ...opening('connected') },
    { id: ATTENTION, label: 'Needs attention', icon: 'triangle-alert', count: count(counts.attention), ...opening('attention') },
    ...(rows.length === 0 ? [] : [{ id: LIST, label: 'Connections', icon: 'server' as const, count: rows.length, expanded: true, children: rows.map(leafOf) }]),
  ];
}
