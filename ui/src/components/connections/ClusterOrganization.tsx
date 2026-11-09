import React, { useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  defaultKeyboardCoordinateGetter,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { IconButton, Text } from '@omniviewdev/base-ui';
import { LuGripVertical } from 'react-icons/lu';
import { clusterFolderAssignment } from '../../utils/clusterFolderDrop';

const collisionDetection: CollisionDetection = (args) => {
  const sectionDrag = args.active.data.current?.type === 'section';
  const filtered = {
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => container.data.current?.type === (sectionDrag ? 'section' : 'folder-drop'),
    ),
  };
  return sectionDrag
    ? closestCenter(filtered)
    : args.pointerCoordinates
      ? pointerWithin(filtered)
      : rectIntersection(filtered);
};
const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) =>
  args.context.active?.data.current?.type === 'section'
    ? sortableKeyboardCoordinates(event, args)
    : defaultKeyboardCoordinateGetter(event, args);

export function ClusterOrganization({
  children,
  onAssignToGroup,
}: {
  children: React.ReactNode;
  onAssignToGroup: (groupId: string, connectionId: string) => void | Promise<void>;
}) {
  const [error, setError] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragEnd={({ active, over }) => {
        const assignment = clusterFolderAssignment(active.data.current, over?.data.current);
        if (!assignment) return;
        setError('');
        void Promise.resolve()
          .then(() => onAssignToGroup(assignment.groupId, assignment.connectionId))
          .catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : 'Could not add cluster to folder');
          });
      }}
    >
      {children}
      {error && (
        <Text role="alert" size="sm" tone="danger">
          {error}
        </Text>
      )}
    </DndContext>
  );
}

export function ClusterDragHandle({
  connectionId,
  sourceGroupId,
}: {
  connectionId: string;
  sourceGroupId?: string;
}) {
  const instanceId = React.useId();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `cluster:${sourceGroupId ?? 'all'}:${connectionId}:${instanceId}`,
    data: { type: 'connection', connectionId, sourceGroupId },
  });
  return (
    <IconButton
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      size="sm"
      variant="ghost"
      aria-label="Drag cluster to folder"
      title="Drag to folder; press Space to lift, arrows to move, Space to drop, Escape to cancel"
      style={{ touchAction: 'none', opacity: isDragging ? 0.5 : undefined }}
      onClick={(event) => event.stopPropagation()}
    >
      <LuGripVertical />
    </IconButton>
  );
}

export function ClusterFolderDropTarget({
  groupId,
  children,
}: {
  groupId: string;
  children: React.ReactNode;
}) {
  const instanceId = React.useId();
  const { setNodeRef, isOver } = useDroppable({
    id: `folder:${groupId}:${instanceId}`,
    data: { type: 'folder-drop', groupId },
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        borderRadius: 'var(--ov-radius-sm)',
        outline: isOver ? '2px solid var(--ov-color-border-focus)' : undefined,
      }}
    >
      {children}
    </div>
  );
}
