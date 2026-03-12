import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { Link, useWatchState,
  useConnection,
  useResourceTypes,
  useResourceGroups,
  useSnackbar,
  usePluginRouter,
  useEditorSchemas } from '@omniviewdev/runtime';
import { Avatar } from '@omniviewdev/ui';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';
import { LuCog, LuLock, LuLockOpen, LuRotateCcw } from 'react-icons/lu';
import { Outlet, useParams } from 'react-router-dom';

import DraggableNavMenu from '../components/kubernetes/sidebar/DraggableNavMenu';
import { useStoredState } from '@/hooks/useStoredState';
import ResourceCommandPalette from '../components/shared/ResourceCommandPalette';
import SyncProgressDialog from '../components/shared/SyncProgressDialog';
import { useClusterPreferences } from '../hooks/useClusterPreferences';
import { useSidebarLayout } from '../hooks/useSidebarLayout';
import { useSidebarOrder, applyOrder } from '../hooks/useSidebarOrder';
import Layout from '../layouts/resource';
import { stringAvatar } from '../utils/color';

const rootSx = {
  p: 0,
  gap: 0,
} as const;

const sidenavStackSx = {
  maxHeight: '100%',
  height: '100%',
  overflow: 'hidden',
} as const;

const sidenavHeaderSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  p: 1,
  borderRadius: 1,
  border: '1px solid',
  borderColor: 'divider',
} as const;

const clusterAvatarSx = {
  backgroundColor: 'transparent',
  objectFit: 'contain',
  border: 0,
  maxHeight: 28,
  maxWidth: 28,
} as const;

const mainSx = {
  display: 'flex',
  flexDirection: 'column',
} as const;

const mainContentSx = { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } as const;

const clusterNameSx = { textOverflow: 'ellipsis' } as const;

export default function ClusterResourcesPage(): React.ReactElement {
  const { id = '' } = useParams<{ id: string }>();

  const { types } = useResourceTypes({ pluginID: 'kubernetes', connectionID: id });
  const { groups } = useResourceGroups({ pluginID: 'kubernetes', connectionID: id });
  const { connection } = useConnection({ pluginID: 'kubernetes', connectionID: id });
  const { connectionOverrides } = useClusterPreferences('kubernetes');
  const { layout: rawLayout } = useSidebarLayout({ connectionID: id });
  const { order, setOrder, isEditing, setIsEditing, resetOrder } = useSidebarOrder();
  const layout = React.useMemo(() => applyOrder(rawLayout, order), [rawLayout, order]);
  const { location, navigate } = usePluginRouter();
  const [savedExpandedState, setSavedExpandedState] = useStoredState<Record<string, boolean>>(
    `kubernetes-${id}-sidebar-expanded`,
    {},
  );

  const handleExpandedChange = React.useCallback(
    (state: Record<string, boolean>) => {
      setSavedExpandedState(state);
    },
    [setSavedExpandedState],
  );
  const { isFullySynced, summary } = useWatchState({ pluginID: 'kubernetes', connectionID: id });

  // Fetch and register OpenAPI schemas with the host's Monaco schema registry
  const { schemas: editorSchemas } = useEditorSchemas({ pluginID: 'kubernetes', connectionID: id });
  React.useEffect(() => {
    // The Monaco schema registry is attached to window by the host app at runtime.
    // It exposes register/unregister methods for managing JSON schemas.
    const win = window as Window & {
      __monacoSchemaRegistry?: {
        register: (plugin: string, connId: string, schemas: typeof editorSchemas) => void;
        unregister: (plugin: string, connId: string) => void;
      };
    };
    const registry = win.__monacoSchemaRegistry;
    if (!registry || !editorSchemas?.length || !id) return;

    registry.register('kubernetes', id, editorSchemas);

    return () => {
      registry.unregister('kubernetes', id);
    };
  }, [editorSchemas, id]);

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { showSnackbar } = useSnackbar();

  // Sync modal — open only when we know the connection is actively syncing,
  // not before data has loaded. `undefined` = "haven't decided yet".
  const [syncModalOpen, setSyncModalOpen] = React.useState<boolean | undefined>(undefined);

  // Track whether the modal was opened manually (e.g. footer Details click)
  // so we don't auto-close it.
  const manualOpenRef = React.useRef(false);

  // Once summary data loads, decide whether to show the modal
  React.useEffect(() => {
    if (syncModalOpen !== undefined) return; // already decided
    if (!summary.data) return; // data not loaded yet — don't decide
    if (!isFullySynced) {
      setSyncModalOpen(true);
    } else {
      setSyncModalOpen(false);
    }
  }, [summary.data, isFullySynced, syncModalOpen]);

  // Auto-close after sync completes — only when auto-opened (not user-initiated)
  React.useEffect(() => {
    if (isFullySynced && syncModalOpen === true && !manualOpenRef.current) {
      const timer = setTimeout(() => setSyncModalOpen(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [isFullySynced, syncModalOpen]);

  const handleCloseSyncModal = React.useCallback(() => {
    manualOpenRef.current = false;
    setSyncModalOpen(false);
  }, []);

  // Listen for footer click to re-open sync modal
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ connectionID?: string }>).detail;
      if (detail?.connectionID === id) {
        manualOpenRef.current = true;
        setSyncModalOpen(true);
      }
    };
    window.addEventListener('ov:show-sync-modal', handler);
    return () => window.removeEventListener('ov:show-sync-modal', handler);
  }, [id]);

  // Derive selected sidebar item from current route.
  // Dashboard routes end with 'resources', 'metrics', or 'benchmarks'.
  const DASHBOARD_TABS = new Set(['resources', 'metrics', 'benchmarks']);
  const lastSegment = location.pathname.split('/').pop() ?? '';
  const selected = DASHBOARD_TABS.has(lastSegment) ? '__dashboard__' : lastSegment;

  const handleSelect = React.useCallback(
    (resourceID: string) => {
      if (resourceID === '__dashboard__') {
        navigate(`/cluster/${id}/resources`);
      } else {
        navigate(`/cluster/${id}/resources/${resourceID}`);
      }
    },
    [navigate, id],
  );

  React.useEffect(() => {
    showSnackbar({
      message: 'You are currently running in development mode',
      details:
        'Rendering performance will be slightly degraded until this application is built for production.',
      status: 'info',
      showOnce: true,
      autoHideDuration: 15000,
    });
  }, [showSnackbar]);

  if (groups.isLoading || connection.isLoading || !groups.data || !connection.data) {
    return (
      <SyncProgressDialog
        open={syncModalOpen === true}
        onClose={handleCloseSyncModal}
        clusterName={id}
        pluginID="kubernetes"
        connectionID={id}
      />
    );
  }

  if (groups.isError) {
    return <>{types.error}</>;
  }

  const clusterName = connectionOverrides[id]?.displayName || connection.data?.name || id;

  return (
    <Layout.Root
      sx={rootSx}
    >
      <ResourceCommandPalette connectionID={id} layout={layout} onNavigate={handleSelect} />
      <Layout.SideNav type="bordered" padding={0.5}>
        <Stack
          direction="column"
          sx={sidenavStackSx}
          gap={0.5}
        >
          <Box
            sx={sidenavHeaderSx}
          >
            <Stack direction="row" alignItems="center" gap={1}>
              {(() => {
                const override = connectionOverrides[id];
                const avatarSrc = override?.avatar || connection.data?.avatar;
                if (avatarSrc) {
                  return (
                    <Avatar
                      size="sm"
                      src={avatarSrc}
                      sx={clusterAvatarSx}
                    />
                  );
                }
                const avatarProps = stringAvatar(
                  override?.displayName || connection.data?.name || '',
                );
                if (override?.avatarColor) {
                  avatarProps.sx = { ...avatarProps.sx, bgcolor: override.avatarColor };
                }
                return <Avatar size="sm" {...avatarProps} />;
              })()}
              <Text weight="semibold" size="sm" sx={clusterNameSx}>
                {connectionOverrides[id]?.displayName || connection.data?.name}
              </Text>
            </Stack>
            <Stack direction="row" alignItems="center" gap={0.5}>
              {isEditing && (
                <Tooltip title="Reset to default order" placement="bottom">
                  <span>
                    <IconButton emphasis="soft" size="sm" color="neutral" onClick={resetOrder}>
                      <LuRotateCcw size={16} />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              <Tooltip title={isEditing ? 'Lock sidebar order' : 'Reorder sidebar'} placement="bottom">
                <span>
                  <IconButton
                    emphasis="soft"
                    size="sm"
                    color={isEditing ? 'primary' : 'neutral'}
                    onClick={() => setIsEditing((prev: boolean) => !prev)}
                  >
                    {isEditing ? <LuLockOpen size={16} /> : <LuLock size={16} />}
                  </IconButton>
                </span>
              </Tooltip>
              <Link to={`/cluster/${id}/edit`}>
                <IconButton emphasis="soft" size="sm" color="neutral">
                  <LuCog size={20} />
                </IconButton>
              </Link>
            </Stack>
          </Box>
          <DraggableNavMenu
            sections={layout}
            selected={selected}
            onSelect={handleSelect}
            scrollable
            isEditing={isEditing}
            onReorder={setOrder}
            initialExpandedState={savedExpandedState}
            onExpandedChange={handleExpandedChange}
          />
        </Stack>
      </Layout.SideNav>
      <Layout.Main
        sx={mainSx}
      >
        <Box sx={mainContentSx}>
          <Outlet />
        </Box>
      </Layout.Main>
      <SyncProgressDialog
        open={syncModalOpen === true}
        onClose={handleCloseSyncModal}
        clusterName={clusterName}
        pluginID="kubernetes"
        connectionID={id}
      />
    </Layout.Root>
  );
}
