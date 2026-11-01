import { TreeList, type Key, type TreeNodeMeta } from '@omniviewdev/base-ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LuGripVertical } from 'react-icons/lu';

import type { SidebarOrder } from '../../../hooks/useSidebarOrder';
import type { NavSection, NavMenuItem } from '../../../types/navigation';

import styles from './ResourceNavTree.module.css';
import { sidebarOrderFromTree } from './sidebarTreeOrder';

export interface ResourceNavTreeProps {
  sections: NavSection[];
  selected?: string;
  onSelect?: (id: string) => void;
  isEditing: boolean;
  onReorder: (order: SidebarOrder) => void;
  scrollable?: boolean;
  initialExpandedState?: Record<string, boolean>;
  onExpandedChange?: (state: Record<string, boolean>) => void;
}

const itemKey = (item: NavMenuItem) => item.id;
const getChildren = (item: NavMenuItem) => item.children;
const getTextValue = (item: NavMenuItem) => item.label;
const isSelectable = (item: NavMenuItem) => !item.children?.length || item.selectable === true;

function visit(
  items: NavMenuItem[],
  fn: (item: NavMenuItem, ancestors: string[]) => void,
  ancestors: string[] = [],
) {
  for (const item of items) {
    fn(item, ancestors);
    if (item.children) visit(item.children, fn, [...ancestors, item.id]);
  }
}

export default function ResourceNavTree({
  sections,
  selected,
  onSelect,
  isEditing,
  onReorder,
  scrollable,
  initialExpandedState,
  onExpandedChange,
}: ResourceNavTreeProps) {
  const source = useMemo(() => {
    const nodes = new Map<string, NavMenuItem>();
    const defaults: Record<string, boolean> = {};
    const ancestors = new Map<string, string[]>();
    const disabled = new Set<Key>();
    const sectionIndexes = new Map<Key, number>();
    const headings = new Map<string, string>();
    sections.forEach((section, index) => {
      if (section.items[0] && section.title) headings.set(section.items[0].id, section.title);
      visit(section.items, (item, path) => {
        sectionIndexes.set(item.id, index);
        nodes.set(item.id, item);
        ancestors.set(item.id, path);
        if (item.defaultExpanded) defaults[item.id] = true;
        if (item.disabled) disabled.add(item.id);
      });
    });
    return { nodes, defaults, ancestors, disabled, sectionIndexes, headings };
  }, [sections]);
  const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const order = useMemo(() => {
    const next = new Map<Key | null, readonly Key[]>([[null, items.map(itemKey)]]);
    visit(items, (item) => {
      if (item.children?.length) next.set(item.id, item.children.map(itemKey));
    });
    return next;
  }, [items]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    ...source.defaults,
    ...initialExpandedState,
  }));
  const persisted = useRef(expanded);
  const onExpandedChangeRef = useRef(onExpandedChange);
  useLayoutEffect(() => {
    onExpandedChangeRef.current = onExpandedChange;
  }, [onExpandedChange]);
  const [rendered, setRendered] = useState<{ source: typeof source; selected?: string }>({
    source,
  });
  if (rendered.source !== source || rendered.selected !== selected) {
    setRendered({ source, selected });
    setExpanded((previous) => {
      const next = { ...source.defaults, ...previous };
      for (const ancestor of source.ancestors.get(selected ?? '') ?? []) next[ancestor] = true;
      return Object.keys(next).some((key) => next[key] !== previous[key]) ? next : previous;
    });
  }
  useEffect(() => {
    if (persisted.current !== expanded) {
      persisted.current = expanded;
      onExpandedChangeRef.current?.(expanded);
    }
  }, [expanded]);
  const expandedKeys = useMemo(
    () => new Set(Object.keys(expanded).filter((key) => expanded[key])),
    [expanded],
  );
  const selectedKeys = useMemo(() => new Set(selected ? [selected] : []), [selected]);
  const activate = useCallback(
    (key: Key) => {
      const item = source.nodes.get(String(key));
      if (!item || item.disabled) return;
      if (item.children?.length) {
        setExpanded((previous) => ({
          ...previous,
          [item.id]: item.selectable && selected !== item.id ? true : !previous[item.id],
        }));
      }
      if (isSelectable(item)) onSelect?.(item.id);
    },
    [source, selected, onSelect],
  );

  const Row = isEditing ? TreeList.ReorderableItem : TreeList.Item;
  const renderItem = useCallback(
    (item: NavMenuItem, node: TreeNodeMeta) => (
      <>
        {source.headings.has(item.id) && (
          <div className={styles.sectionTitle}>{source.headings.get(item.id)}</div>
        )}
        <Row
          itemKey={item.id}
          aria-label={item.label}
          textValue={item.label}
          selectable={isSelectable(item)}
          disabled={item.disabled}
        >
          <TreeList.ItemIndent
            depth={node.depth}
            ancestorIsLast={node.ancestorIsLast}
            isLastChild={node.isLastChild}
          />
          {isEditing && (
            <TreeList.ItemDragHandle aria-label={`Move ${item.label}`}>
              <LuGripVertical size={12} />
            </TreeList.ItemDragHandle>
          )}
          <TreeList.ItemToggle itemKey={item.id} />
          {item.icon && <TreeList.ItemIcon>{item.icon}</TreeList.ItemIcon>}
          <TreeList.ItemLabel>{item.label}</TreeList.ItemLabel>
          {item.badge}
        </Row>
      </>
    ),
    [source, isEditing, Row],
  );
  return (
    <TreeList.Root
      className={scrollable ? styles.scrollable : undefined}
      aria-label="Cluster resources"
      items={items}
      itemKey={itemKey}
      getChildren={getChildren}
      getTextValue={getTextValue}
      isItemSelectable={isSelectable}
      disabledKeys={source.disabled}
      selectedKeys={selectedKeys}
      expandedKeys={expandedKeys}
      onAction={activate}
      onExpandedKeysChange={(keys) =>
        setExpanded((previous) => {
          const next = { ...previous };
          visit(items, (item) => {
            if (item.children?.length) next[item.id] = keys.has(item.id);
          });
          return next;
        })
      }
      reorderable={isEditing}
      order={order}
      onOrderChange={(nextOrder, event) => {
        const sectionIndex = source.sectionIndexes.get(event.activeKey);
        if (sectionIndex === undefined || sectionIndex !== source.sectionIndexes.get(event.overKey))
          return;
        const next = sidebarOrderFromTree(sections, sectionIndex, nextOrder, event);
        if (next) onReorder(next);
      }}
      selectionMode="single"
      density="compact"
      indentation={14}
      indentGuide="rail"
      virtualized
      estimatedItemSize={28}
      renderItem={renderItem}
    >
      <TreeList.Viewport className={scrollable ? styles.viewport : undefined} />
    </TreeList.Root>
  );
}
