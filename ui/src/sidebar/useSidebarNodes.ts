import { useMemo } from 'react';

import { useChosenConnection } from '../connection';
import type { SidebarContextV1, SidebarNodeV1 } from '../contract/v1';
import { sidebarNodes } from '../kinds';

import { ALL_NAMESPACES } from './scope';
import { useSidebarCounts } from './useSidebarCounts';

/**
 * The sidebar's data hook (the contribution contract's `useNodes`): the skeleton's nodes with the count of each entry. The host calls it with the context every hook of the plugin gets and the groups of the
 * tree that are open on screen, and draws what it answers in place of the skeleton; it answers nothing, so that the skeleton stays, while it does not know which connection it is for (the plugin's
 * connections are on their way, or it has none). The connection is the one the pages read: the route's when the plugin knows it, else the plugin's first.
 *
 * The answer is the same array until a count changes, which the host does not run again for a render of its own. There is no namespace menu yet, so the sidebar counts every namespace, as the lists read
 * every namespace.
 */
export function useSidebarNodes({ plugin, route, open }: SidebarContextV1): readonly SidebarNodeV1[] | undefined {
  const { chosen } = useChosenConnection(plugin, route.connection);
  const connection = chosen?.id;
  const counts = useSidebarCounts({ plugin, connection, open, scope: ALL_NAMESPACES });
  const known = connection !== undefined;
  return useMemo(() => (known ? sidebarNodes(counts) : undefined), [known, counts]);
}
