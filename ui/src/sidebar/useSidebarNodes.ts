import { useMemo, useSyncExternalStore } from 'react';

import { useChosenConnection } from '../connection';
import type { SidebarContextV1, SidebarNodeV1 } from '../contract/v1';
import { sidebarNodes } from '../kinds';
import { isLandingPage } from '../landing/entry';
import { navigatorOf } from '../landing/navigator';

import { ALL_NAMESPACES } from './scope';
import { useSidebarCounts } from './useSidebarCounts';

/**
 * The sidebar's data hook (the contribution contract's `useNodes`). The host calls it with the context every hook of the plugin gets, the groups of the tree that are open on screen and the plugin's connections, and draws
 * what it answers in place of the skeleton.
 *
 * On a page of a connection it answers the skeleton's nodes with the count of each entry, and nothing (so that the skeleton stays) while it does not know which connection it is for (the plugin's connections are on
 * their way, or it has none). The connection is the one the pages read: the route's when the plugin knows it, else the plugin's first. The answer is the same array until a count changes, which the host does not run
 * again for a render of its own, and none of the connections' own changes (their states, what the host is doing to them) is one. There is no namespace menu yet, so the sidebar counts every namespace, as the lists read
 * every namespace.
 *
 * On a page of the landing, which is read in no connection, the sidebar is the navigator (`landing/navigator.ts`): the plugin's home, the state filters of the page of all the connections and the connections themselves,
 * drawn from the connections and the parameters of the page on screen (`route.params`). Nothing is counted there: no connection is read.
 */
export function useSidebarNodes({ plugin, route, open, connections }: SidebarContextV1): readonly SidebarNodeV1[] | undefined {
  const landing = isLandingPage(route.page);
  const { chosen } = useChosenConnection(plugin, route.connection);
  const connection = landing ? undefined : chosen?.id;
  const counts = useSidebarCounts({ plugin, connection, open, scope: ALL_NAMESPACES });
  const known = connection !== undefined;
  const view = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const { params } = route;
  const resources = useMemo(() => (known ? sidebarNodes(counts) : undefined), [known, counts]);
  const navigator = useMemo(() => (landing ? navigatorOf(view, params) : undefined), [landing, view, params]);
  return landing ? navigator : resources;
}
