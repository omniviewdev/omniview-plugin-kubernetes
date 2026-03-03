import type { NavSection, NavMenuItem } from '@omniviewdev/ui/sidebars';

import { useStoredState } from '../components/shared/hooks/useStoredState';

export interface SidebarOrder {
  items: string[];
  children: Record<string, string[]>;
}

/**
 * Reorder an array of items according to a stored ordering.
 * Items present in `order` come first (in that order), followed by any
 * items not in `order` (preserving their original relative ordering).
 */
function reorderByIds<T extends { id: string }>(items: T[], order: string[]): T[] {
  const indexMap = new Map(order.map((id, i) => [id, i]));
  const ordered: T[] = [];
  const rest: T[] = [];

  for (const item of items) {
    if (indexMap.has(item.id)) {
      ordered.push(item);
    } else {
      rest.push(item);
    }
  }

  ordered.sort((a, b) => indexMap.get(a.id)! - indexMap.get(b.id)!);
  return [...ordered, ...rest];
}

/**
 * Apply a stored sidebar order on top of a computed layout.
 * Returns a new array — never mutates the input.
 */
export function applyOrder(
  layout: NavSection[],
  order: SidebarOrder | null,
): NavSection[] {
  if (!order || !layout.length) return layout;

  return layout.map((section) => {
    const reorderedItems = reorderByIds(section.items, order.items).map((item) => {
      if (!item.children?.length) return item;

      const childOrder = order.children[item.id];
      if (!childOrder?.length) return item;

      return { ...item, children: reorderByIds(item.children, childOrder) };
    });

    return { ...section, items: reorderedItems };
  });
}

/**
 * Extract the current ordering from a layout so it can be persisted.
 */
export function extractOrder(layout: NavSection[]): SidebarOrder {
  const items: string[] = [];
  const children: Record<string, string[]> = {};

  for (const section of layout) {
    for (const item of section.items) {
      items.push(item.id);
      if (item.children?.length) {
        children[item.id] = item.children.map((c: NavMenuItem) => c.id);
      }
    }
  }

  return { items, children };
}

const STORAGE_KEY_ORDER = 'kubernetes-sidebar-order';
const STORAGE_KEY_EDITING = 'kubernetes-sidebar-edit-mode';

export function useSidebarOrder() {
  const [order, setOrder] = useStoredState<SidebarOrder | null>(STORAGE_KEY_ORDER, null);
  const [isEditing, setIsEditing] = useStoredState<boolean>(STORAGE_KEY_EDITING, false);

  const resetOrder = () => setOrder(null);

  return { order, setOrder, isEditing, setIsEditing, resetOrder } as const;
}
