import { Button, Dialog, IconButton, Menu } from '@omniviewdev/base-ui';
import {
  useConnection,
  usePluginContext,
  usePluginRouter,
  useNotifications,
  useWindowActions,
} from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';
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
  LuAppWindow,
  LuSquarePlus,
} from 'react-icons/lu';

import type { ConnectionGroup, EnrichedConnection } from '../../types/clusters';
import { computeEffectiveMembers } from '../../utils/folderRules';
import ClusterConnectionDetails from './ClusterConnectionDetails';
import { FolderIconDisplay, resolveFolderImage } from '../../utils/folderIcons';
import { useClusterPreferences } from '../../hooks/useClusterPreferences';

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
  enriched?: EnrichedConnection;
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
  enriched,
}) => {
  const { navigate } = usePluginRouter();
  const { pluginId } = usePluginContext();
  const { iconAssets } = useClusterPreferences(pluginId);
  const { openInNewTab, openInNewWindow } = useWindowActions();
  const [preview, setPreview] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const pendingOpen = React.useRef(false);
  const { notify } = useNotifications();
  const { startConnection } = useConnection({
    pluginID: pluginId,
    connectionID: connectionId,
    enabled: false,
  });
  const openElsewhere = async (open: (path: string) => void) => {
    if (pendingOpen.current) return;
    pendingOpen.current = true;
    setOpening(true);
    try {
      if (!isConnected) {
        const result = await startConnection();
        if (result.status !== types.ConnectionStatusCode.ConnectionStatusConnected) {
          void notify({
            severity: 'warning',
            title: 'Could not open cluster: connection is not ready',
            details: result.details,
          });
          return;
        }
      }
      try {
        open(resourcesPath);
      } catch (error) {
        void notify({
          severity: 'error',
          title: error instanceof Error ? error.message : 'Could not open cluster',
        });
      }
    } catch {
      // Connection failures already report lifecycle details.
    } finally {
      pendingOpen.current = false;
      setOpening(false);
    }
  };
  // Same page a click on the connection opens, as a host route.
  const resourcesPath = `/_plugin/${pluginId}/cluster/${encodeURIComponent(connectionId)}/resources`;

  const deleteName =
    connectionName.length > 30 ? `${connectionName.slice(0, 30)}...` : connectionName;

  const hasFolders = customGroups.length > 0 || !!onCreateFolder;

  return (
    // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions
    <span onClick={(e) => e.stopPropagation()}>
      <Menu.Root size="xs">
        <Menu.Trigger
          render={
            <IconButton
              aria-label={`Actions for ${connectionName}`}
              size="sm"
              variant="ghost"
              color="neutral"
            >
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
                startDecorator={<LuSquarePlus size={ICON_SIZE} />}
                disabled={opening}
                onClick={() => {
                  void openElsewhere(openInNewTab);
                }}
              >
                Open in new tab
              </Menu.Item>
              <Menu.Item
                startDecorator={<LuAppWindow size={ICON_SIZE} />}
                disabled={opening}
                onClick={() => {
                  void openElsewhere(openInNewWindow);
                }}
              >
                Open in new window
              </Menu.Item>
              <Menu.Separator />

              <Menu.Item
                startDecorator={<LuPencil size={ICON_SIZE} />}
                onClick={() => navigate(`/cluster/${encodeURIComponent(connectionId)}/edit`)}
              >
                Settings
              </Menu.Item>
              {enriched && <Menu.Item onClick={() => setPreview(true)}>Preview</Menu.Item>}
              <Menu.Item startDecorator={<LuStar size={ICON_SIZE} />} onClick={onToggleFavorite}>
                {isFavorite ? 'Unpin' : 'Pin'}
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
                          const automatic =
                            !!enriched &&
                            computeEffectiveMembers([], group.ruleSet, [enriched]).has(
                              connectionId,
                            );
                          return (
                            <Menu.Item
                              key={`folder-${group.id}`}
                              startDecorator={
                                isInGroup ? (
                                  <LuCheck size={ICON_SIZE} />
                                ) : (
                                  <FolderIconDisplay
                                    icon={group.icon}
                                    customImage={resolveFolderImage(group, iconAssets)}
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
                              {automatic
                                ? isInGroup
                                  ? ' · manual + automatic'
                                  : ' · automatic (add manual)'
                                : isInGroup
                                  ? ' · manual (remove)'
                                  : ''}
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
      {preview && enriched && (
        <Dialog open onClose={() => setPreview(false)} size="md">
          <Dialog.Title>Cluster preview</Dialog.Title>
          <Dialog.Body>
            <ClusterConnectionDetails
              connectionID={connectionId}
              connection={enriched.connection}
              override={{
                displayName: enriched.displayName,
                description: enriched.displayDescription,
                avatar: enriched.avatar,
                avatarColor: enriched.avatarColor,
                tags: enriched.tags,
              }}
            />
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="ghost" onClick={() => setPreview(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setPreview(false);
                navigate(`/cluster/${encodeURIComponent(connectionId)}/edit`);
              }}
            >
              Settings
            </Button>
          </Dialog.Footer>
        </Dialog>
      )}
    </span>
  );
};

export default ConnectionContextMenu;
