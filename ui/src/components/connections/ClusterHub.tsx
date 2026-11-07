import {
  useDndMonitor,
  useDroppable,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, Stack, Text } from '@omniviewdev/base-ui';
import React from 'react';
import { usePluginContext } from '@omniviewdev/runtime';
import { useClusterPreferences } from '../../hooks/useClusterPreferences';

import { useHubSections, type HubSectionData } from '../../hooks/useHubSections';
import type {
  EnrichedConnection,
  ConnectionAttribute,
  ConnectionGroup,
  HubSectionConfig,
  HubSectionType,
} from '../../types/clusters';

import GroupBrowser from './GroupBrowser';
import HubSection from './HubSection';
import QuickConnectGrid from './QuickConnectGrid';
import RowHandler from './RowHandler';

const hubStackStyle: React.CSSProperties = { padding: '4px 4px 16px', gap: 8 };

const dragOverlayCardStyle: React.CSSProperties = {
  padding: 8,
  opacity: 0.8,
  width: 200,
  pointerEvents: 'none',
};

/** Shape of the drag data attached to connection items in dnd-kit */
interface ConnectionDragData {
  type: 'connection';
  connectionId: string;
  sectionId?: string;
}

/** Shape of the drag data attached to section items in dnd-kit */
interface SectionDragData {
  type: 'section';
}

/** Shape of the drag data for folder drop zones */
interface FolderDropData {
  type: 'folder-drop';
  groupId: string;
}

type DragData = ConnectionDragData | SectionDragData | FolderDropData;

type Props = {
  enrichedConnections: EnrichedConnection[];
  availableAttributes: ConnectionAttribute[];
  customGroups: ConnectionGroup[];
  hubSections: HubSectionConfig[];
  onReorderSections: (sections: HubSectionConfig[]) => void;
  onToggleCollapse: (sectionType: HubSectionType, collapsed: boolean) => void;
  onToggleFavorite: (connectionId: string) => void;
  onCreateFolder?: (connectionId?: string) => void;
  onEditFolder?: (groupId: string) => void;
};

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

const ClusterHub: React.FC<Props> = ({
  enrichedConnections,
  availableAttributes,
  customGroups,
  hubSections: hubSectionConfigs,
  onReorderSections,
  onToggleCollapse,
  onToggleFavorite,
  onCreateFolder,
  onEditFolder,
}) => {
  const { pluginId } = usePluginContext();
  const { iconAssets } = useClusterPreferences(pluginId);
  const { sections, reorderSections } = useHubSections({
    enrichedConnections,
    hubSectionConfigs,
    customGroups,
    iconAssets,
  });

  // Track active drag for overlay
  const [activeDrag, setActiveDrag] = React.useState<{
    type: 'connection' | 'section';
    id: string;
    connectionId?: string;
  } | null>(null);

  const visibleSections = React.useMemo(
    () =>
      sections.filter((s) => {
        if (s.config.type === 'browse') return availableAttributes.length > 0;
        // Always show group sections (folders) even if empty
        if (s.config.type.startsWith('group:')) return true;
        return s.data.length > 0;
      }),
    [sections, availableAttributes],
  );

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const { active } = event;
    // dnd-kit types data.current as Record<string, any> | undefined; cast to our known shape
    const data = active.data.current as DragData | undefined;
    if (data?.type === 'connection') {
      setActiveDrag({ type: 'connection', id: String(active.id), connectionId: data.connectionId });
    } else {
      setActiveDrag({ type: 'section', id: String(active.id) });
    }
  }, []);

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDrag(null);

      // dnd-kit types data.current as Record<string, any> | undefined; cast to our known shape
      const activeData = active.data.current as DragData | undefined;

      // Shared ClusterOrganization handles connection assignments, including sidebar targets.
      if (activeData?.type === 'connection') return;

      // Section reorder
      if (over && activeData?.type === 'section' && active.id !== over.id) {
        const newConfigs = reorderSections(String(active.id), String(over.id));
        onReorderSections(newConfigs);
      }
    },
    [reorderSections, onReorderSections],
  );
  useDndMonitor({
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onDragCancel: () => setActiveDrag(null),
  });

  const visibleSectionIds = React.useMemo(
    () => visibleSections.map((s) => s.config.type),
    [visibleSections],
  );

  // Find dragged connection for overlay
  const draggedConnection = React.useMemo(() => {
    if (activeDrag?.type !== 'connection' || !activeDrag.connectionId) return null;
    return enrichedConnections.find((c) => c.connection.id === activeDrag.connectionId) ?? null;
  }, [activeDrag, enrichedConnections]);

  return (
    <>
      <Stack direction="column" style={hubStackStyle}>
        {/* Zone 1: Quick-connect grid -- always visible, cards are draggable */}
        <QuickConnectGrid
          connections={enrichedConnections}
          onToggleFavorite={onToggleFavorite}
          onCreateFolder={onCreateFolder}
        />

        {/* Zone 2: DnD sections -- only when any section has items */}
        {visibleSections.length > 0 && (
          <SortableContext items={visibleSectionIds} strategy={verticalListSortingStrategy}>
            <Stack direction="column" spacing={1}>
              {visibleSections.map((section) => (
                <DroppableSectionWrapper
                  key={section.config.type}
                  section={section}
                  isDraggingConnection={activeDrag?.type === 'connection'}
                >
                  <SectionRenderer
                    section={section}
                    availableAttributes={availableAttributes}
                    enrichedConnections={enrichedConnections}
                    onToggleCollapse={onToggleCollapse}
                    onToggleFavorite={onToggleFavorite}
                    onEditFolder={onEditFolder}
                  />
                </DroppableSectionWrapper>
              ))}
            </Stack>
          </SortableContext>
        )}
      </Stack>

      <DragOverlay dropAnimation={null}>
        {draggedConnection && (
          <Card variant="outline" elevation={2} style={dragOverlayCardStyle}>
            <Text as="div" size="sm" weight="semibold" truncate>
              {draggedConnection.displayName}
            </Text>
          </Card>
        )}
      </DragOverlay>
    </>
  );
};

/**
 * Wraps group sections with a droppable zone when a connection is being dragged.
 */
const DroppableSectionWrapper: React.FC<{
  section: HubSectionData;
  isDraggingConnection: boolean;
  children: React.ReactNode;
}> = ({ section, isDraggingConnection, children }) => {
  const isGroup = section.config.type.startsWith('group:');

  if (!isGroup) return <>{children}</>;

  return (
    <FolderDropZone groupId={section.groupId!} isDraggingConnection={isDraggingConnection}>
      {children}
    </FolderDropZone>
  );
};

const FolderDropZone: React.FC<{
  groupId: string;
  isDraggingConnection: boolean;
  children: React.ReactNode;
}> = ({ groupId, isDraggingConnection, children }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder-drop:${groupId}`,
    data: { type: 'folder-drop', groupId },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        borderRadius: 'var(--ov-radius-sm, 4px)',
        transition: 'outline-color 0.15s, background-color 0.15s',
        outline: isDraggingConnection ? '2px dashed' : 'none',
        outlineColor: isOver ? 'var(--ov-color-brand-500)' : 'var(--ov-color-border-control)',
        backgroundColor: isOver ? 'var(--ov-color-accent-soft)' : 'transparent',
      }}
    >
      {children}
    </div>
  );
};

/**
 * Renders a single hub section with its content based on section type.
 */
const SectionRenderer: React.FC<{
  section: HubSectionData;
  availableAttributes: ConnectionAttribute[];
  enrichedConnections: EnrichedConnection[];
  onToggleCollapse: (sectionType: HubSectionType, collapsed: boolean) => void;
  onToggleFavorite: (connectionId: string) => void;
  onEditFolder?: (groupId: string) => void;
}> = ({
  section,
  availableAttributes,
  enrichedConnections,
  onToggleCollapse,
  onToggleFavorite,
  onEditFolder,
}) => {
  const { config, title, data, groupId, groupColor, groupIcon, groupCustomImage, emptyHint } =
    section;
  const isRecent = config.type === 'recent';
  const isBrowse = config.type === 'browse';
  const isGroup = config.type.startsWith('group:');

  return (
    <HubSection
      id={config.type}
      title={title}
      count={isBrowse ? availableAttributes.length : data.length}
      collapsed={config.collapsed}
      onToggleCollapse={() => onToggleCollapse(config.type, !config.collapsed)}
      variant={isBrowse ? 'passthrough' : 'grid'}
      folderColor={groupColor}
      folderIcon={groupIcon}
      folderCustomImage={groupCustomImage}
      onEdit={isGroup && groupId && onEditFolder ? () => onEditFolder(groupId) : undefined}
      showEmpty={isGroup}
      emptyHint={emptyHint}
    >
      {isBrowse ? (
        <GroupBrowser connections={enrichedConnections} availableAttributes={availableAttributes} />
      ) : (
        data.map((enriched) => (
          <RowHandler
            key={enriched.connection.id}
            enriched={enriched}
            sectionId={config.type}
            subtitle={isRecent ? formatRelativeTime(enriched.lastAccessed) : undefined}
            showFavorite={config.type === 'favorites'}
            onToggleFavorite={() => onToggleFavorite(enriched.connection.id)}
          />
        ))
      )}
    </HubSection>
  );
};

export default ClusterHub;
