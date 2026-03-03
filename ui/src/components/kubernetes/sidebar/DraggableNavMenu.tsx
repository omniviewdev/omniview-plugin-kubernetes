import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { LuChevronRight, LuChevronDown, LuGripVertical } from 'react-icons/lu';
import type { NavSection, NavMenuItem as NavMenuItemType } from '@omniviewdev/ui/sidebars';

import { type SidebarOrder, extractOrder } from '../../../hooks/useSidebarOrder';

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

const FONT_SIZE = 12;
const CHEVRON_SIZE = 12;
const CHEVRON_SLOT = 14;
const INDENT = 10;

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
  parentId,
  onChildReorder,
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

  return (
    <Box ref={setNodeRef} style={style}>
      <Box
        onClick={() => {
          if (item.disabled) return;
          if (hasChildren) {
            onToggleExpanded(item.id);
          } else {
            onSelect?.(item.id);
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          pl: `${depth * INDENT + 4}px`,
          pr: '6px',
          py: '3px',
          cursor: item.disabled ? 'default' : 'pointer',
          opacity: item.disabled ? 0.5 : 1,
          borderRadius: '4px',
          mx: '4px',
          my: '1px',
          bgcolor: isSelected ? 'var(--ov-accent-subtle)' : 'transparent',
          color: isSelected ? 'var(--ov-accent-fg)' : 'var(--ov-fg-default)',
          fontWeight: isSelected ? 600 : hasChildren ? 500 : 400,
          '&:hover': {
            bgcolor: isSelected ? 'var(--ov-accent-subtle)' : 'var(--ov-state-hover)',
          },
        }}
      >
        {isEditing && (
          <Box
            {...attributes}
            {...listeners}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'grab',
              color: 'var(--ov-fg-faint)',
              flexShrink: 0,
              '&:hover': { color: 'var(--ov-fg-default)' },
              '&:active': { cursor: 'grabbing' },
            }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <LuGripVertical size={12} />
          </Box>
        )}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: CHEVRON_SLOT,
            minWidth: CHEVRON_SLOT,
            flexShrink: 0,
            color: 'var(--ov-fg-faint)',
          }}
        >
          {hasChildren && (isExpanded
            ? <LuChevronDown size={CHEVRON_SIZE} />
            : <LuChevronRight size={CHEVRON_SIZE} />
          )}
        </Box>
        {item.icon && (
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, fontSize: FONT_SIZE + 2 }}>
            {item.icon}
          </Box>
        )}
        <Typography
          variant="body2"
          sx={{ flex: 1, fontSize: FONT_SIZE, color: 'inherit', fontWeight: 'inherit' }}
          noWrap
        >
          {item.label}
        </Typography>
        {item.badge}
      </Box>
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
        />
      )}
    </Box>
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
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const itemIds = useMemo(() => items.map((i) => i.id), [items]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        onChildReorder?.(parentId, active.id as string, over.id as string);
      }
    },
    [parentId, onChildReorder],
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
      onDragEnd={handleDragEnd}
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
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

// ──────────────────── Main component ────────────────────

const scrollableSx = {
  overflow: 'auto',
  maxHeight: '100%',
  flex: 1,
  minHeight: 0,
  scrollbarWidth: 'none' as const,
  '&::-webkit-scrollbar': { display: 'none' },
};

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
  const [sections, setSections] = useState(sectionsProp);
  const isDragging = useRef(false);

  useEffect(() => {
    if (!isDragging.current) {
      setSections(sectionsProp);
    }
  }, [sectionsProp]);

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
  onExpandedChangeRef.current = onExpandedChange;

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
      isDragging.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      setSections((prev) => {
        const sectionIdx = prev.findIndex((s) => s.items.some((i) => i.id === active.id));
        const overSectionIdx = prev.findIndex((s) => s.items.some((i) => i.id === over.id));
        if (sectionIdx === -1 || overSectionIdx === -1 || sectionIdx !== overSectionIdx) return prev;

        const section = prev[sectionIdx];
        const oldIndex = section.items.findIndex((i) => i.id === active.id);
        const newIndex = section.items.findIndex((i) => i.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return prev;

        const newSections = [...prev];
        newSections[sectionIdx] = { ...section, items: arrayMove(section.items, oldIndex, newIndex) };

        onReorder(extractOrder(newSections));
        return newSections;
      });
    },
    [onReorder],
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

      setSections((prev) => {
        const newSections = prev.map((section) => ({
          ...section,
          items: reorderInTree(section.items),
        }));

        onReorder(extractOrder(newSections));
        return newSections;
      });
    },
    [onReorder],
  );

  const rootSx = scrollable ? scrollableSx : undefined;

  if (!isEditing) {
    return (
      <Box sx={rootSx}>
        {sections.map((section, i) => (
          <Box key={section.title || `section-${i}`} sx={{ mb: 0.5, mt: i === 0 ? 0 : 0.25 }}>
            {section.title && (
              <Typography
                variant="overline"
                sx={{
                  display: 'block',
                  px: '12px',
                  py: '4px',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  color: 'var(--ov-fg-faint)',
                  textTransform: 'uppercase',
                }}
              >
                {section.title}
              </Typography>
            )}
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
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box sx={rootSx}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={() => { isDragging.current = true; }}
        onDragEnd={handleTopLevelDragEnd}
        onDragCancel={() => { isDragging.current = false; }}
      >
        <SortableContext items={topLevelIds} strategy={verticalListSortingStrategy}>
          {sections.map((section, i) => (
            <Box key={section.title || `section-${i}`} sx={{ mb: 0.5, mt: i === 0 ? 0 : 0.25 }}>
              {section.title && (
                <Typography
                  variant="overline"
                  sx={{
                    display: 'block',
                    px: '12px',
                    py: '4px',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    color: 'var(--ov-fg-faint)',
                    textTransform: 'uppercase',
                  }}
                >
                  {section.title}
                </Typography>
              )}
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
                />
              ))}
            </Box>
          ))}
        </SortableContext>
      </DndContext>
    </Box>
  );
}

DraggableNavMenu.displayName = 'DraggableNavMenu';
