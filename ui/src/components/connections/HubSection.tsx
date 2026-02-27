import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Box from '@mui/material/Box';
import MuiIconButton from '@mui/material/IconButton';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';
import { LuChevronDown, LuChevronRight, LuGripVertical, LuPencil } from 'react-icons/lu';

import { FolderIconDisplay } from '../../utils/folderIcons';

const headerRowSx = {
  py: 0.5,
  px: 0.5,
  borderRadius: 'sm',
  userSelect: 'none',
  '&:hover .folder-edit-btn': { opacity: 1 },
} as const;

const dragHandleSx = {
  cursor: 'grab',
  display: 'flex',
  alignItems: 'center',
  color: 'neutral.400',
  '&:hover': { color: 'neutral.600' },
  '&:active': { cursor: 'grabbing' },
} as const;

const toggleAreaSx = {
  cursor: 'pointer',
  flex: 1,
  borderRadius: 'sm',
  py: 0.25,
  px: 0.25,
  '&:hover': { backgroundColor: 'background.level1' },
} as const;

const countSx = { opacity: 0.5 } as const;

const editButtonSx = { opacity: 0, transition: 'opacity 0.15s', width: 24, height: 24 } as const;

const emptyHintSx = { py: 2, px: 1, textAlign: 'center', opacity: 0.5 } as const;

const gridSx = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 1,
  py: 0.5,
  px: 0.5,
} as const;

const passthroughSx = { py: 0.5, px: 0.5 } as const;

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
  };

  const isEmpty = count === 0;
  if (isEmpty && !showEmpty) return null;

  const isFolder = !!folderColor || !!folderIcon || !!folderCustomImage;

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={folderColor ? { borderLeft: `3px solid ${folderColor}`, pl: 0.5 } : undefined}
    >
      <Stack
        direction="row"
        alignItems="center"
        gap={0.5}
        sx={headerRowSx}
      >
        <Box
          {...attributes}
          {...listeners}
          sx={dragHandleSx}
        >
          <LuGripVertical size={14} />
        </Box>
        <Stack
          direction="row"
          alignItems="center"
          gap={0.75}
          onClick={onToggleCollapse}
          sx={toggleAreaSx}
        >
          {collapsed ? <LuChevronRight size={14} /> : <LuChevronDown size={14} />}
          {isFolder && (
            <Box sx={{ display: 'flex', color: folderColor }}>
              <FolderIconDisplay
                icon={folderIcon}
                customImage={folderCustomImage}
                size={14}
                color={folderColor}
              />
            </Box>
          )}
          <Text weight="semibold" size="sm">
            {title}
          </Text>
          <Text size="xs" sx={countSx}>
            ({count})
          </Text>
        </Stack>
        {onEdit && (
          <MuiIconButton
            className="folder-edit-btn"
            size="small"
            color="default"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            sx={editButtonSx}
          >
            <LuPencil size={12} />
          </MuiIconButton>
        )}
      </Stack>
      {!collapsed &&
        (isEmpty ? (
          emptyHint ? (
            <Text size="xs" sx={emptyHintSx}>
              {emptyHint}
            </Text>
          ) : null
        ) : variant === 'grid' ? (
          <Box
            sx={gridSx}
          >
            {children}
          </Box>
        ) : (
          <Box sx={passthroughSx}>{children}</Box>
        ))}
    </Box>
  );
};

export default HubSection;
