import type { TreeOrder, TreeReorderEvent } from '@omniviewdev/base-ui';

import { applyOrder, extractOrder, type SidebarOrder } from '../../../hooks/useSidebarOrder';
import type { NavMenuItem, NavSection } from '../../../types/navigation';

/** Convert only a valid sibling move, retaining every current source node and section. */
export function sidebarOrderFromTree(
  sections: NavSection[],
  sectionIndex: number,
  order: TreeOrder,
  event: TreeReorderEvent,
): SidebarOrder | undefined {
  const section = sections[sectionIndex];
  if (!section) return;
  function findChildren(items: NavMenuItem[]): NavMenuItem[] | undefined {
    for (const item of items) {
      if (item.id === event.parentKey) return item.children;
      if (item.children) {
        const children = findChildren(item.children);
        if (children) return children;
      }
    }
  }
  const siblings = event.parentKey === null ? section.items : findChildren(section.items);
  if (
    !siblings?.some((item) => item.id === event.activeKey) ||
    !siblings.some((item) => item.id === event.overKey)
  )
    return;
  const children: Record<string, string[]> = {};
  for (const [parent, keys] of order) {
    if (parent !== null) children[String(parent)] = keys.map(String);
  }
  const reordered = applyOrder([section], {
    items: (order.get(null) ?? []).map(String),
    children,
  })[0];
  return extractOrder(
    sections.map((source, index) => (index === sectionIndex ? reordered : source)),
  );
}
