import { useDraggable } from '@dnd-kit/core';
import React from 'react';

import { useClusterAction } from '../../hooks/useClusterAction';
import type { EnrichedConnection } from '../../types/clusters';

import HubClusterRow from './HubClusterRow';

type Props = {
  enriched: EnrichedConnection;
  /** Section identifier to make drag IDs unique across sections */
  sectionId?: string;
  subtitle?: string;
  showFavorite?: boolean;
  onToggleFavorite: () => void;
};

/**
 * Wrapper component that provides useClusterAction hook context
 * for each row, since useConnection requires connectionID at hook level.
 * Also makes the row draggable for folder assignment.
 */
const RowHandler: React.FC<Props> = ({
  enriched,
  sectionId = 'default',
  subtitle,
  showFavorite,
  onToggleFavorite,
}) => {
  const { handleClick } = useClusterAction(enriched.connection.id, enriched.isConnected);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `connection:${sectionId}:${enriched.connection.id}`,
    data: { type: 'connection', connectionId: enriched.connection.id, sectionId },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        opacity: isDragging ? 0.4 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
    >
      <HubClusterRow
        enriched={enriched}
        subtitle={subtitle}
        showFavorite={showFavorite}
        onToggleFavorite={onToggleFavorite}
        onClick={() => { void handleClick(); }}
      />
    </div>
  );
};

export default RowHandler;
