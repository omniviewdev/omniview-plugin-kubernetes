import type React from 'react';

/**
 * Sidebar navigation types (formerly `NavSection` / `NavMenuItem` from
 * `@omniviewdev/ui/sidebars`, which has no base-ui equivalent).
 */
export interface NavSection {
  title: string;
  items: NavMenuItem[];
}

export interface NavMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  children?: NavMenuItem[];
  disabled?: boolean;
  /** A parent with children can also be a navigable destination. */
  selectable?: boolean;
  /** Start expanded when first rendered. Only relevant for items with children. */
  defaultExpanded?: boolean;
}
