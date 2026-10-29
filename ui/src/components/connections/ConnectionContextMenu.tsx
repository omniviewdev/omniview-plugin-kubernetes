import { IconButton, Menu } from '@omniviewdev/base-ui';
import { usePluginRouter } from '@omniviewdev/runtime';
import React from 'react';
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

  const hasFolders = customGroups.length > 0 || !!onCreateFolder;

  return (
    // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions
    <span onClick={(e) => e.stopPropagation()}>
      <Menu.Root size="xs">
        <Menu.Trigger
          render={
            <IconButton aria-label="More" size="sm" variant="ghost" color="neutral">
              <LuEllipsisVertical size={16} />
            </IconButton>
          }
        />
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4}>
            <Menu.Popup>
              {isConnected ? (
                <Menu.Item startDecorator={<LuUnplug size={ICON_SIZE} />} onClick={onDisconnect}>
                  Disconnect
                </Menu.Item>
              ) : (
                <Menu.Item startDecorator={<LuPlug size={ICON_SIZE} />} onClick={onConnect}>
                  Connect
                </Menu.Item>
              )}
              <Menu.Separator />

              <Menu.Item
                startDecorator={<LuPencil size={ICON_SIZE} />}
                onClick={() => navigate(`/cluster/${encodeURIComponent(connectionId)}/edit`)}
              >
                Edit
              </Menu.Item>
              <Menu.Item startDecorator={<LuStar size={ICON_SIZE} />} onClick={onToggleFavorite}>
                {isFavorite ? 'Unfavorite' : 'Favorite'}
              </Menu.Item>

              {hasFolders && (
                <Menu.SubmenuRoot>
                  <Menu.SubmenuTrigger startDecorator={<LuFolder size={ICON_SIZE} />} showCaret>
                    Folders
                  </Menu.SubmenuTrigger>
                  <Menu.Portal>
                    <Menu.Positioner sideOffset={4}>
                      <Menu.Popup>
                        {customGroups.map((group) => {
                          const isInGroup = group.connectionIds.includes(connectionId);
                          return (
                            <Menu.Item
                              key={`folder-${group.id}`}
                              startDecorator={
                                isInGroup ? (
                                  <LuCheck size={ICON_SIZE} />
                                ) : (
                                  <FolderIconDisplay
                                    icon={group.icon}
                                    customImage={group.customImage}
                                    size={ICON_SIZE}
                                    color={group.color}
                                  />
                                )
                              }
                              onClick={() => {
                                if (isInGroup && onRemoveFromGroup) {
                                  onRemoveFromGroup(group.id);
                                } else if (!isInGroup) {
                                  onAssignToGroup(group.id);
                                }
                              }}
                            >
                              {group.name}
                            </Menu.Item>
                          );
                        })}
                        {onCreateFolder && (
                          <Menu.Item
                            startDecorator={<LuFolderPlus size={ICON_SIZE} />}
                            onClick={() => onCreateFolder(connectionId)}
                          >
                            New Folder...
                          </Menu.Item>
                        )}
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.SubmenuRoot>
              )}
              <Menu.Separator />

              <Menu.Item startDecorator={<LuCopy size={ICON_SIZE} />} onClick={onCopyId}>
                Copy Connection ID
              </Menu.Item>
              <Menu.Separator />

              <Menu.Item
                color="danger"
                startDecorator={<LuTrash size={ICON_SIZE} />}
                onClick={onDelete}
              >
                {`Delete '${deleteName}'`}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </span>
  );
};

export default ConnectionContextMenu;
