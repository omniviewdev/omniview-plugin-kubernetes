import {
  Avatar,
  Badge,
  Chip,
  IconButton,
  Menu,
  Spinner,
  Stack,
  Text,
} from '@omniviewdev/base-ui';
import {
  usePluginRouter,
  usePluginContext,
  useConnection,
  useSnackbar,
} from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';
import React from 'react';
import { LuEllipsisVertical, LuPencil, LuTrash } from 'react-icons/lu';

import NamedAvatar from '../shared/NamedAvatar';

import styles from './ConnectionListItem.module.css';


const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 8px',
};

const avatarWrapperStyle: React.CSSProperties = { marginRight: 12, display: 'flex' };

const avatarStyle: React.CSSProperties = {
  borderRadius: 6,
  backgroundColor: 'transparent',
  objectFit: 'contain',
  border: 0,
  maxHeight: 28,
  maxWidth: 28,
};

const nameStackStyle: React.CSSProperties = { width: '100%' };

const innerNameStackStyle: React.CSSProperties = { width: '100%', height: '100%', gap: 16 };

const chipStyle: React.CSSProperties = { pointerEvents: 'none' };

type Props = Omit<types.Connection, 'createFrom' | 'convertValues'>;

const ConnectionListItem: React.FC<Props> = ({
  id,
  name,
  description,
  avatar,
  labels,
  last_refresh,
  expiry_time,
}) => {
  const { meta } = usePluginContext();
  const { navigate } = usePluginRouter();
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { showSnackbar } = useSnackbar();

  const { startConnection } = useConnection({ pluginID: meta.id, connectionID: id });
  const [connecting, setConnecting] = React.useState(false);

  const handleConnectionStatus = (status: types.ConnectionStatus) => {
    switch (status.status) {
      case types.ConnectionStatusCode.ConnectionStatusUnauthorized:
        showSnackbar({
          status: 'warning',
          message: `Failed to authorize to '${name}'`,
          details: status.details,
          icon: 'LuShieldClose',
        });
        break;
      case types.ConnectionStatusCode.ConnectionStatusConnected:
        showSnackbar({
          status: 'success',
          message: `Connected to '${name}'`,
          icon: 'LuCheckCircle',
        });
        navigate(`/connection/${id}/resources`);
        break;
      default:
        showSnackbar({
          status: 'error',
          message: `Failed to connect to '${name}'`,
          details: status.details,
          icon: 'LuCircleAlert',
        });
    }
  };

  const handleClick = () => {
    if (isConnected()) {
      navigate(`/connection/${id}/resources`);
      return;
    }

    setConnecting(true);
    startConnection()
      .then((status) => {
        handleConnectionStatus(status);
      })
      .catch((err) => {
        if (err instanceof Error) {
          showSnackbar({
            status: 'error',
            message: err.message,
            icon: 'LuCircleAlert',
          });
        }
      })
      .finally(() => {
        setConnecting(false);
      });
  };

  /**
   * Determines if we're connected
   */
  const isConnected = () => {
    // compute from last refresh (timestamp) and expiry time (duration)
    const refreshTime = new Date(last_refresh);
    // if we have no valid refresh time, we can't determine if the connection is connected, so assume we are
    if (refreshTime.toString() === 'Invalid Date') {
      console.warn('Invalid Date for refresh time', last_refresh);
      return true;
    }

    const now = new Date();
    return refreshTime.getTime() + expiry_time > now.getTime();
  };

  return (
    <div id={`connection-${id}`} style={containerStyle}>
      {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions */}
      <div className={styles.clickableRow} onClick={handleClick}>
        <div style={avatarWrapperStyle}>
          <Badge variant="dot" color="success" invisible={!isConnected()} size="sm" position="top-right">
            {avatar ? (
              <Avatar size="sm" shape="rounded" src={avatar} style={avatarStyle} />
            ) : (
              <NamedAvatar value={name} />
            )}
          </Badge>
        </div>
        <Stack direction="row" align="center" style={nameStackStyle}>
          <Stack direction="row" align="center" style={innerNameStackStyle}>
            <Text weight="semibold" size="sm" truncate>
              {name}
            </Text>
            {Boolean(description) && (
              <Text size="sm" truncate>
                {description}
              </Text>
            )}
            {connecting && <Spinner size="sm" />}
          </Stack>
          <Stack direction="row" align="center" spacing={2}>
            {labels &&
              Object.entries(labels)
                .sort()
                .map(([key, _]) => (
                  <Chip key={key} variant="outline" color="brand" size="sm" style={chipStyle}>
                    {key}
                  </Chip>
                ))}
          </Stack>
        </Stack>
      </div>
      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton size="sm" variant="ghost" color="neutral" aria-label="More">
              <LuEllipsisVertical />
            </IconButton>
          }
        />
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4}>
            <Menu.Popup style={{ minWidth: 140 }}>
              <Menu.Item
                startDecorator={<LuPencil size={14} />}
                onClick={() => navigate(`/connection/${id}/edit`)}
              >
                Edit &apos;{name}&apos;
              </Menu.Item>
              <Menu.Item startDecorator={<LuTrash size={14} />}>Delete &apos;{name}&apos;</Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
};

export default ConnectionListItem;
