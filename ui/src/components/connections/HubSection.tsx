import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconButton, Text } from '@omniviewdev/base-ui';
import React from 'react';
import { LuChevronDown, LuChevronRight, LuGripVertical, LuPencil } from 'react-icons/lu';

import { FolderIconDisplay } from '../../utils/folderIcons';

import styles from './Connections.module.css';

const countStyle: React.CSSProperties = { opacity: 0.5 };

const editButtonStyle: React.CSSProperties = { width: 24, height: 24, minWidth: 24 };

const emptyHintStyle: React.CSSProperties = {
  display: 'block',
  padding: '16px 8px',
  textAlign: 'center',
  opacity: 0.5,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 8,
  padding: 4,
};

const passthroughStyle: React.CSSProperties = { padding: 4 };

type Props = {
  id: string;
  title: string;
  count: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** 'grid' wraps children in a responsive card grid; 'passthrough' renders children as-is */
  variant?: 'grid' | 'passthrough';
  folderColor?: string;
  folderIcon?: string;
  folderCustomImage?: string;
  onEdit?: () => void;
  /** Show section even when empty (for folder drop targets) */
  showEmpty?: boolean;
  emptyHint?: string;
  children: React.ReactNode;
};

const HubSection: React.FC<Props> = ({
  id,
  title,
  count,
  collapsed,
  onToggleCollapse,
  variant = 'grid',
  folderColor,
  folderIcon,
  folderCustomImage,
  onEdit,
  showEmpty,
  emptyHint,
  children,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: 'section' },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    ...(folderColor ? { borderLeft: `3px solid ${folderColor}`, paddingLeft: 4 } : {}),
  };

  const isEmpty = count === 0;
  if (isEmpty && !showEmpty) return null;

  const isFolder = !!folderColor || !!folderIcon || !!folderCustomImage;

  return (
    <div ref={setNodeRef} style={style}>
      <div className={styles.sectionHeader}>
        <div {...attributes} {...listeners} className={styles.dragHandle}>
          <LuGripVertical size={14} />
        </div>
        {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions */}
        <div className={styles.sectionToggle} onClick={onToggleCollapse}>
          {collapsed ? <LuChevronRight size={14} /> : <LuChevronDown size={14} />}
          {isFolder && (
            <span style={{ display: 'flex', color: folderColor }}>
              <FolderIconDisplay
                icon={folderIcon}
                customImage={folderCustomImage}
                size={14}
                color={folderColor}
              />
            </span>
          )}
          <Text weight="semibold" size="sm">
            {title}
          </Text>
          <Text size="xs" style={countStyle}>
            ({count})
          </Text>
        </div>
        {onEdit && (
          <IconButton
            className={styles.sectionEditButton}
            size="sm"
            variant="ghost"
            color="neutral"
            aria-label="Edit folder"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            style={editButtonStyle}
          >
            <LuPencil size={12} />
          </IconButton>
        )}
      </div>
      {!collapsed &&
        (isEmpty ? (
          emptyHint ? (
            <Text size="xs" style={emptyHintStyle}>
              {emptyHint}
            </Text>
          ) : null
        ) : variant === 'grid' ? (
          <div style={gridStyle}>{children}</div>
        ) : (
          <div style={passthroughStyle}>{children}</div>
        ))}
    </div>
  );
};

export default HubSection;
