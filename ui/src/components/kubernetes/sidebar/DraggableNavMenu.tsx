import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { LuChevronRight, LuChevronDown, LuGripVertical } from 'react-icons/lu';

import { type SidebarOrder, extractOrder } from '../../../hooks/useSidebarOrder';
import type { NavSection, NavMenuItem as NavMenuItemType } from '../../../types/navigation';

import styles from './DraggableNavMenu.module.css';

export interface DraggableNavMenuProps {
  sections: NavSection[];
  selected?: string;
  onSelect?: (id: string) => void;
  isEditing: boolean;
  onReorder: (order: SidebarOrder) => void;
  scrollable?: boolean;
  initialExpandedState?: Record<string, boolean>;
  onExpandedChange?: (state: Record<string, boolean>) => void;
}

const CHEVRON_SIZE = 12;
const INDENT = 10;

/**
 * A parent whose own id is a destination (e.g. a plugin-contributed page with
 * sub-pages). Other parents are pure group headers that only expand.
 */
const isSelectableParent = (item: NavMenuItemType): boolean =>
  (item as NavMenuItemType & { selectable?: boolean }).selectable === true;

function getExplicitExpanded(sections: NavSection[]): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  function walk(items: NavMenuItemType[]) {
    for (const item of items) {
      if (item.defaultExpanded) state[item.id] = true;
      if (item.children) walk(item.children);
    }
  }
  for (const section of sections) walk(section.items);
  return state;
}

function findAncestors(sections: NavSection[], targetId: string): string[] {
  const path: string[] = [];
  function walk(items: NavMenuItemType[]): boolean {
    for (const item of items) {
      if (item.id === targetId) return true;
      if (item.children && item.children.length > 0) {
        path.push(item.id);
        if (walk(item.children)) return true;
        path.pop();
      }
    }
    return false;
  }
  for (const section of sections) {
    if (walk(section.items)) return [...path];
    path.length = 0;
  }
  return [];
}

// ──────────────────── Sortable wrappers ────────────────────

function SortableItem({
  item,
  depth,
  selected,
  onSelect,
  expandedState,
  onToggleExpanded,
  isEditing,
  parentId: _parentId,
  onChildReorder,
  setIsDragging,
}: {
  item: NavMenuItemType;
  depth: number;
  selected?: string;
  onSelect?: (id: string) => void;
  expandedState: Record<string, boolean>;
  onToggleExpanded: (id: string) => void;
  isEditing: boolean;
  parentId?: string;
  onChildReorder?: (parentId: string, activeId: string, overId: string) => void;
  setIsDragging?: (v: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !isEditing });

  const isExpanded = expandedState[item.id] ?? false;
  const isSelected = selected === item.id;
  const hasChildren = item.children && item.children.length > 0;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 10 : undefined,
  };

  const activate = () => {
    if (item.disabled) return;
    if (hasChildren && isSelectableParent(item)) {
      // Navigate to the parent's own page; only collapse on a second click.
      if (!isExpanded || isSelected) onToggleExpanded(item.id);
      onSelect?.(item.id);
    } else if (hasChildren) {
      onToggleExpanded(item.id);
    } else {
      onSelect?.(item.id);
    }
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={styles.row}
        data-selected={isSelected ? 'true' : undefined}
        data-disabled={item.disabled ? 'true' : undefined}
        data-has-children={hasChildren ? 'true' : undefined}
        role="button"
        tabIndex={item.disabled ? -1 : 0}
        aria-disabled={item.disabled || undefined}
        aria-expanded={hasChildren ? isExpanded : undefined}
        onClick={activate}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        }}
        style={{ paddingLeft: `${depth * INDENT + 4}px` }}
      >
        {isEditing && (
          // dnd-kit's `attributes`/`listeners` supply role, tabIndex and keyboard handlers.
          // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions
          <div
            {...attributes}
            {...listeners}
            className={styles.dragHandle}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <LuGripVertical size={12} />
          </div>
        )}
        <div className={styles.chevronSlot}>
          {hasChildren && (isExpanded
            ? <LuChevronDown size={CHEVRON_SIZE} />
            : <LuChevronRight size={CHEVRON_SIZE} />
          )}
        </div>
        {item.icon && <div className={styles.icon}>{item.icon}</div>}
        <span className={styles.label}>{item.label}</span>
        {item.badge}
      </div>
      {hasChildren && isExpanded && item.children && (
        <ChildSortableContext
          parentId={item.id}
          items={item.children}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
          expandedState={expandedState}
          onToggleExpanded={onToggleExpanded}
          isEditing={isEditing}
          onChildReorder={onChildReorder}
          setIsDragging={setIsDragging}
        />
      )}
    </div>
  );
}

function ChildSortableContext({
  parentId,
  items,
  depth,
  selected,
  onSelect,
  expandedState,
  onToggleExpanded,
  isEditing,
  onChildReorder,
  setIsDragging,
}: {
  parentId: string;
  items: NavMenuItemType[];
  depth: number;
  selected?: string;
  onSelect?: (id: string) => void;
  expandedState: Record<string, boolean>;
  onToggleExpanded: (id: string) => void;
  isEditing: boolean;
  onChildReorder?: (parentId: string, activeId: string, overId: string) => void;
  setIsDragging?: (v: boolean) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const itemIds = useMemo(() => items.map((i) => i.id), [items]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setIsDragging?.(false);
      const { active, over } = event;
      if (over && active.id !== over.id) {
        onChildReorder?.(parentId, active.id as string, over.id as string);
      }
    },
    [parentId, onChildReorder, setIsDragging],
  );

  if (!isEditing) {
    return (
      <>
        {items.map((child) => (
          <SortableItem
            key={child.id}
            item={child}
            depth={depth}
            selected={selected}
            onSelect={onSelect}
            expandedState={expandedState}
            onToggleExpanded={onToggleExpanded}
            isEditing={false}
            parentId={parentId}
          />
        ))}
      </>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragStart={() => { setIsDragging?.(true); }}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setIsDragging?.(false); }}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {items.map((child) => (
          <SortableItem
            key={child.id}
            item={child}
            depth={depth}
            selected={selected}
            onSelect={onSelect}
            expandedState={expandedState}
            onToggleExpanded={onToggleExpanded}
            isEditing={isEditing}
            parentId={parentId}
            onChildReorder={onChildReorder}
            setIsDragging={setIsDragging}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

// ──────────────────── Main component ────────────────────

export default function DraggableNavMenu({
  sections: sectionsProp,
  selected,
  onSelect,
  isEditing,
  onReorder,
  scrollable,
  initialExpandedState,
  onExpandedChange,
}: DraggableNavMenuProps) {
  // Local copy for optimistic reorder during drag — kept in sync with
  // incoming props so layout changes (e.g. new resources) are reflected.
  const [isDraggingState, setIsDragging] = useState(false);
  const [sections, setSections] = useState(sectionsProp);
  const [prevSectionsProp, setPrevSectionsProp] = useState(sectionsProp);
  const [pendingSectionsProp, setPendingSectionsProp] = useState<NavSection[] | null>(null);

  if (prevSectionsProp !== sectionsProp) {
    if (isDraggingState) {
      setPendingSectionsProp(sectionsProp);
    } else {
      setPrevSectionsProp(sectionsProp);
      setSections(sectionsProp);
      setPendingSectionsProp(null);
    }
  }

  // ── Expand/collapse state (mirroring NavMenu logic) ──
  const computeExpanded = useMemo(
    () => getExplicitExpanded(sections),
    [sections],
  );

  const [expandedState, setExpandedState] = useState<Record<string, boolean>>(() => ({
    ...computeExpanded,
    ...(initialExpandedState ?? {}),
  }));

  const onExpandedChangeRef = useRef(onExpandedChange);
  useEffect(() => {
    onExpandedChangeRef.current = onExpandedChange;
  }, [onExpandedChange]);

  const updateExpanded = useCallback(
    (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => {
      setExpandedState((prev) => {
        const next = updater(prev);
        if (next !== prev) onExpandedChangeRef.current?.(next);
        return next;
      });
    },
    [],
  );

  const prevSectionsRef = useRef(sections);
  useEffect(() => {
    if (prevSectionsRef.current !== sections) {
      prevSectionsRef.current = sections;
      updateExpanded((prev) => {
        const merged = { ...prev };
        let changed = false;
        for (const key of Object.keys(computeExpanded)) {
          if (!(key in merged)) {
            merged[key] = computeExpanded[key];
            changed = true;
          }
        }
        return changed ? merged : prev;
      });
    }
  }, [sections, computeExpanded, updateExpanded]);

  useEffect(() => {
    if (!selected) return;
    const ancestors = findAncestors(sections, selected);
    if (ancestors.length > 0) {
      updateExpanded((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const id of ancestors) {
          if (!next[id]) {
            next[id] = true;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [selected, sections, updateExpanded]);

  const handleToggle = useCallback(
    (id: string) => updateExpanded((prev) => ({ ...prev, [id]: !prev[id] })),
    [updateExpanded],
  );

  // ── Top-level DnD ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const topLevelIds = useMemo(
    () => sections.flatMap((s) => s.items.map((i) => i.id)),
    [sections],
  );

  const handleTopLevelDragEnd = useCallback(
    (event: DragEndEvent) => {
      setIsDragging(false);
      const { active, over } = event;
      if (!over || active.id === over.id) {
        if (pendingSectionsProp) {
          setSections(pendingSectionsProp);
          setPrevSectionsProp(pendingSectionsProp);
          setPendingSectionsProp(null);
        }
        return;
      }

      // Compute reorder outside the updater to keep it pure
      const base = pendingSectionsProp ?? sections;
      const sectionIdx = base.findIndex((s) => s.items.some((i) => i.id === active.id));
      const overSectionIdx = base.findIndex((s) => s.items.some((i) => i.id === over.id));
      if (sectionIdx === -1 || overSectionIdx === -1 || sectionIdx !== overSectionIdx) {
        if (pendingSectionsProp) {
          setSections(pendingSectionsProp);
          setPrevSectionsProp(pendingSectionsProp);
          setPendingSectionsProp(null);
        }
        return;
      }

      const section = base[sectionIdx];
      const oldIndex = section.items.findIndex((i) => i.id === active.id);
      const newIndex = section.items.findIndex((i) => i.id === over.id);
      if (oldIndex === -1 || newIndex === -1) {
        if (pendingSectionsProp) {
          setSections(pendingSectionsProp);
          setPrevSectionsProp(pendingSectionsProp);
          setPendingSectionsProp(null);
        }
        return;
      }

      const newSections = [...base];
      newSections[sectionIdx] = { ...section, items: arrayMove(section.items, oldIndex, newIndex) };

      setSections(newSections);
      if (pendingSectionsProp) {
        setPrevSectionsProp(pendingSectionsProp);
        setPendingSectionsProp(null);
      }
      onReorder(extractOrder(newSections));
    },
    [onReorder, pendingSectionsProp, sections],
  );

  const handleChildReorder = useCallback(
    (parentId: string, activeId: string, overId: string) => {
      function reorderInTree(items: NavMenuItemType[]): NavMenuItemType[] {
        return items.map((item) => {
          if (item.id === parentId && item.children) {
            const oldIndex = item.children.findIndex((c) => c.id === activeId);
            const newIndex = item.children.findIndex((c) => c.id === overId);
            if (oldIndex === -1 || newIndex === -1) return item;
            return { ...item, children: arrayMove(item.children, oldIndex, newIndex) };
          }
          if (item.children?.length) {
            return { ...item, children: reorderInTree(item.children) };
          }
          return item;
        });
      }

      const base = pendingSectionsProp ?? sections;
      const newSections = base.map((section) => ({
        ...section,
        items: reorderInTree(section.items),
      }));

      setSections(newSections);
      if (pendingSectionsProp) {
        setPrevSectionsProp(pendingSectionsProp);
        setPendingSectionsProp(null);
      }
      onReorder(extractOrder(newSections));
    },
    [onReorder, pendingSectionsProp, sections],
  );

  const rootClassName = scrollable ? styles.scrollable : undefined;

  if (!isEditing) {
    return (
      <div className={rootClassName}>
        {sections.map((section, i) => (
          <div key={section.title || `section-${i}`} style={{ marginBottom: 4, marginTop: i === 0 ? 0 : 2 }}>
            {section.title && <span className={styles.sectionTitle}>{section.title}</span>}
            {section.items.map((item) => (
              <SortableItem
                key={item.id}
                item={item}
                depth={0}
                selected={selected}
                onSelect={onSelect}
                expandedState={expandedState}
                onToggleExpanded={handleToggle}
                isEditing={false}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={rootClassName}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={() => { setIsDragging(true); }}
        onDragEnd={handleTopLevelDragEnd}
        onDragCancel={() => {
          setIsDragging(false);
          if (pendingSectionsProp) {
            setSections(pendingSectionsProp);
            setPrevSectionsProp(pendingSectionsProp);
            setPendingSectionsProp(null);
          }
        }}
      >
        <SortableContext items={topLevelIds} strategy={verticalListSortingStrategy}>
          {sections.map((section, i) => (
            <div key={section.title || `section-${i}`} style={{ marginBottom: 4, marginTop: i === 0 ? 0 : 2 }}>
              {section.title && <span className={styles.sectionTitle}>{section.title}</span>}
              {section.items.map((item) => (
                <SortableItem
                  key={item.id}
                  item={item}
                  depth={0}
                  selected={selected}
                  onSelect={onSelect}
                  expandedState={expandedState}
                  onToggleExpanded={handleToggle}
                  isEditing
                  onChildReorder={handleChildReorder}
                  setIsDragging={setIsDragging}
                />
              ))}
            </div>
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

DraggableNavMenu.displayName = 'DraggableNavMenu';
