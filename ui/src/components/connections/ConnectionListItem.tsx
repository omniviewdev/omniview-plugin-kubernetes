import { MoreVert } from '@mui/icons-material';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import {
  Link,
  usePluginRouter,
  usePluginContext,
  useConnection,
  useSnackbar,
} from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';
import { Avatar, Badge, Chip } from '@omniviewdev/ui';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';
import { LuPencil, LuTrash } from 'react-icons/lu';

import NamedAvatar from '../shared/NamedAvatar';

// Icons

const containerSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  py: 0.5,
  px: 1,
} as const;

const clickableRowSx = {
  display: 'flex',
  flex: 1,
  alignItems: 'center',
  borderRadius: 'sm',
  cursor: 'pointer',
  '&:hover': { bgcolor: 'background.level1' },
  py: 0.5,
  px: 1,
} as const;

const avatarWrapperSx = { mr: 1.5, display: 'flex' } as const;

const avatarSx = {
  borderRadius: 6,
  backgroundColor: 'transparent',
  objectFit: 'contain',
  border: 0,
  maxHeight: 28,
  maxWidth: 28,
} as const;

const nameStackSx = { width: '100%' } as const;

const innerNameStackSx = { width: '100%', height: '100%' } as const;

const chipSx = { pointerEvents: 'none', borderRadius: 'sm' } as const;

const menuContainerSx = { position: 'relative' } as const;

const backdropStyle = { position: 'fixed', inset: 0, zIndex: 999 } as const;

const menuDropdownSx = {
  position: 'absolute',
  right: 0,
  top: '100%',
  zIndex: 1000,
  bgcolor: 'background.surface',
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 'sm',
  boxShadow: 'md',
  py: 0.5,
  minWidth: 140,
} as const;

const menuItemSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  px: 1.5,
  py: 0.75,
  cursor: 'pointer',
  '&:hover': { bgcolor: 'background.level1' },
} as const;

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
  const [menuOpen, setMenuOpen] = React.useState(false);

  const handleConnectionStatus = (status: types.ConnectionStatus) => {
    switch (status.status) {
      case types.ConnectionStatusCode.UNAUTHORIZED:
        showSnackbar({
          status: 'warning',
          message: `Failed to authorize to '${name}'`,
          details: status.details,
          icon: 'LuShieldClose',
        });
        break;
      case types.ConnectionStatusCode.CONNECTED:
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
    const refreshTime = new Date(last_refresh as unknown as string);
    // if we have no valid refresh time, we can't determine if the connection is connected, so assume we are
    if (refreshTime.toString() === 'Invalid Date') {
      console.warn('Invalid Date for refresh time', last_refresh);
      return true;
    }

    const now = new Date();
    return refreshTime.getTime() + expiry_time > now.getTime();
  };

  return (
    <Box
      id={`connection-${id}`}
      sx={containerSx}
    >
      <Box
        sx={clickableRowSx}
        onClick={handleClick}
      >
        <Box sx={avatarWrapperSx}>
          <Badge
            color="success"
            invisible={!isConnected()}
            size="sm"
            anchorOrigin={{
              vertical: 'top',
              horizontal: 'right',
            }}
          >
            {avatar ? (
              <Avatar
                size="sm"
                src={avatar}
                sx={avatarSx}
              />
            ) : (
              <NamedAvatar value={name} />
            )}
          </Badge>
        </Box>
        <Stack direction="row" sx={nameStackSx} alignItems="center">
          <Stack direction="row" sx={innerNameStackSx} alignItems="center" gap={2}>
            <Text weight="semibold" size="sm" noWrap>
              {name}
            </Text>
            {Boolean(description) && (
              <Text size="sm" noWrap>
                {description}
              </Text>
            )}
            {connecting && <CircularProgress size={16} />}
          </Stack>
          <Stack direction="row" gap={1} alignItems="center">
            {labels &&
              Object.entries(labels)
                .sort()
                .map(([key, _]) => (
                  <Chip
                    key={key}
                    emphasis="outline"
                    color="primary"
                    size="sm"
                    sx={chipSx}
                    label={key}
                  />
                ))}
          </Stack>
        </Stack>
      </Box>
      <Box sx={menuContainerSx}>
        <IconButton
          size="sm"
          emphasis="ghost"
          color="neutral"
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          <MoreVert />
        </IconButton>
        {menuOpen && (
          <>
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
            <div
              style={backdropStyle}
              onClick={() => setMenuOpen(false)}
            />
            <Box
              sx={menuDropdownSx}
            >
              <Link to={`/connection/${id}/edit`}>
                <Box
                  sx={menuItemSx}
                  onClick={() => setMenuOpen(false)}
                >
                  <LuPencil size={14} />
                  <Text size="sm">Edit &apos;{name}&apos;</Text>
                </Box>
              </Link>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'background.level1' },
                }}
                onClick={() => setMenuOpen(false)}
              >
                <LuTrash size={14} />
                <Text size="sm">Delete &apos;{name}&apos;</Text>
              </Box>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};

export default ConnectionListItem;
