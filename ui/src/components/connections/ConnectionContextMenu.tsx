import { usePluginRouter } from '@omniviewdev/runtime';
import { IconButton } from '@omniviewdev/ui/buttons';
import { DropdownMenu } from '@omniviewdev/ui/menus';
import type { ContextMenuItem } from '@omniviewdev/ui/menus';
import React, { useMemo } from 'react';
import {
  LuPencil,
  LuTrash,
  LuStar,
  LuPlug,
  LuUnplug,
  LuCopy,
  LuFolder,
  LuFolderPlus,
  LuCheck,
  LuEllipsisVertical,
} from 'react-icons/lu';

import type { ConnectionGroup } from '../../types/clusters';
import { FolderIconDisplay } from '../../utils/folderIcons';

const ICON_SIZE = 14;

type Props = {
  connectionId: string;
  connectionName: string;
  isConnected: boolean;
  isFavorite: boolean;
  customGroups: ConnectionGroup[];
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleFavorite: () => void;
  onAssignToGroup: (groupId: string) => void;
  onRemoveFromGroup?: (groupId: string) => void;
  onCreateFolder?: (connectionId: string) => void;
  onCopyId: () => void;
  onDelete: () => void;
};

const ConnectionContextMenu: React.FC<Props> = ({
  connectionId,
  connectionName,
  isConnected,
  isFavorite,
  customGroups,
  onConnect,
  onDisconnect,
  onToggleFavorite,
  onAssignToGroup,
  onRemoveFromGroup,
  onCreateFolder,
  onCopyId,
  onDelete,
}) => {
  const { navigate } = usePluginRouter();

  const deleteName =
    connectionName.length > 30 ? `${connectionName.slice(0, 30)}...` : connectionName;

  const items = useMemo<ContextMenuItem[]>(() => {
    const result: ContextMenuItem[] = [];

    // Connect / Disconnect
    result.push(
      isConnected
        ? {
            key: 'disconnect',
            label: 'Disconnect',
            icon: <LuUnplug size={ICON_SIZE} />,
            onClick: onDisconnect,
            dividerAfter: true,
          }
        : {
            key: 'connect',
            label: 'Connect',
            icon: <LuPlug size={ICON_SIZE} />,
            onClick: onConnect,
            dividerAfter: true,
          },
    );

    // Edit
    result.push({
      key: 'edit',
      label: 'Edit',
      icon: <LuPencil size={ICON_SIZE} />,
      onClick: () => navigate(`/cluster/${encodeURIComponent(connectionId)}/edit`),
    });

    // Favorite — dividerAfter is set when there's no folders section below
    const hasFolders = customGroups.length > 0 || !!onCreateFolder;
    result.push({
      key: 'favorite',
      label: isFavorite ? 'Unfavorite' : 'Favorite',
      icon: <LuStar size={ICON_SIZE} />,
      onClick: onToggleFavorite,
      dividerAfter: !hasFolders,
    });

    // Folders submenu
    if (hasFolders) {
      const folderChildren: ContextMenuItem[] = customGroups.map((group) => {
        const isInGroup = group.connectionIds.includes(connectionId);
        return {
          key: `folder-${group.id}`,
          label: group.name,
          icon: isInGroup ? (
            <LuCheck size={ICON_SIZE} />
          ) : (
            <FolderIconDisplay
              icon={group.icon}
              customImage={group.customImage}
              size={ICON_SIZE}
              color={group.color}
            />
          ),
          onClick: () => {
            if (isInGroup && onRemoveFromGroup) {
              onRemoveFromGroup(group.id);
            } else if (!isInGroup) {
              onAssignToGroup(group.id);
            }
          },
        };
      });

      if (onCreateFolder) {
        folderChildren.push({
          key: 'new-folder',
          label: 'New Folder...',
          icon: <LuFolderPlus size={ICON_SIZE} />,
          onClick: () => onCreateFolder(connectionId),
        });
      }

      result.push({
        key: 'folders',
        label: 'Folders',
        icon: <LuFolder size={ICON_SIZE} />,
        dividerAfter: true,
        children: folderChildren,
      });
    }

    // Copy ID
    result.push({
      key: 'copy-id',
      label: 'Copy Connection ID',
      icon: <LuCopy size={ICON_SIZE} />,
      onClick: onCopyId,
      dividerAfter: true,
    });

    // Delete
    result.push({
      key: 'delete',
      label: `Delete '${deleteName}'`,
      icon: <LuTrash size={ICON_SIZE} />,
      color: 'danger',
      onClick: onDelete,
    });

    return result;
  }, [
    isConnected,
    isFavorite,
    connectionId,
    connectionName,
    deleteName,
    customGroups,
    onConnect,
    onDisconnect,
    onToggleFavorite,
    onAssignToGroup,
    onRemoveFromGroup,
    onCreateFolder,
    onCopyId,
    onDelete,
    navigate,
  ]);

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <span onClick={(e) => e.stopPropagation()}>
      <DropdownMenu
        items={items}
        size="xs"
        placement="bottom-end"
        trigger={
          <IconButton aria-label="More" size="sm" emphasis="ghost" color="neutral">
            <LuEllipsisVertical size={16} />
          </IconButton>
        }
      />
    </span>
  );
};

export default ConnectionContextMenu;
