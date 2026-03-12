import MuiAvatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import { usePluginContext, useConnection } from '@omniviewdev/runtime';
import { Avatar, Chip } from '@omniviewdev/ui';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Tooltip } from '@omniviewdev/ui/overlays';
import { NavMenu } from '@omniviewdev/ui/sidebars';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';
import { LuArrowLeft, LuCircle, LuSave, LuX } from 'react-icons/lu';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';

import MetricsTabContent from '../../components/settings/MetricsTabContent';
import NodeShellTabContent from '../../components/settings/NodeShellTabContent';
import { useClusterPreferences } from '../../hooks/useClusterPreferences';
import Layout from '../../layouts/resource';
import type { ConnectionOverride } from '../../types/clusters';
import { getInitials } from '../../utils/avatarUtils';
import { stringToColor } from '../../utils/color';

import ClusterInfoSection from './ClusterInfoSection';
import ConnectionSection from './ConnectionSection';
import IdentitySection from './IdentitySection';
import SectionWrapper from './SectionWrapper';
import TagsSection from './TagsSection';
import {
  type SectionId,
  SECTIONS,
  sidenavHeaderSx,
  clusterCardWrapperSx,
  clusterCardSx,
  avatarImgSx,
  clusterNameSx,
  navMenuSx,
  sidenavColumnSx,
  headerTitleSx,
  clusterInfoColumnSx,
  mainPanelSx,
} from './constants';

const ClusterEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const connectionId = id ? decodeURIComponent(id) : '';

  const { meta } = usePluginContext();
  const rrNavigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = (searchParams.get('section') ?? 'identity') as SectionId;

  const { connection } = useConnection({ pluginID: meta.id, connectionID: connectionId });
  const { connectionOverrides, availableTags, updateOverride } = useClusterPreferences(meta.id);

  const existing = connectionOverrides[connectionId] ?? {};
  const conn = connection.data;

  const [displayName, setDisplayName] = React.useState(existing.displayName ?? '');
  const [description, setDescription] = React.useState(existing.description ?? '');
  const [avatarUrl, setAvatarUrl] = React.useState(existing.avatar ?? '');
  const [avatarColor, setAvatarColor] = React.useState(existing.avatarColor ?? '');
  const [tags, setTags] = React.useState<string[]>(existing.tags ?? []);

  // Sync form state when overrides load or connectionId changes
  React.useEffect(() => {
    const o = connectionOverrides[connectionId];
    setDisplayName(o?.displayName ?? '');
    setDescription(o?.description ?? '');
    setAvatarUrl(o?.avatar ?? '');
    setAvatarColor(o?.avatarColor ?? '');
    setTags(o?.tags ?? []);
  }, [connectionOverrides, connectionId]);

  const hasDrafts = React.useMemo(() => {
    const o = connectionOverrides[connectionId] ?? {};
    return (
      displayName !== (o.displayName ?? '') ||
      description !== (o.description ?? '') ||
      avatarUrl !== (o.avatar ?? '') ||
      avatarColor !== (o.avatarColor ?? '') ||
      JSON.stringify(tags) !== JSON.stringify(o.tags ?? [])
    );
  }, [connectionOverrides, connectionId, displayName, description, avatarUrl, avatarColor, tags]);

  const handleSave = async () => {
    const override: ConnectionOverride = { ...existing };
    override.displayName = displayName || undefined;
    override.description = description || undefined;
    override.avatar = avatarUrl || undefined;
    override.avatarColor = avatarColor || undefined;
    override.tags = tags.length > 0 ? tags : undefined;
    await updateOverride(connectionId, override);
    void rrNavigate(-1);
  };

  const handleBack = React.useCallback(() => { void rrNavigate(-1); }, [rrNavigate]);

  const handleCancel = () => {
    const o = connectionOverrides[connectionId] ?? {};
    setDisplayName(o.displayName ?? '');
    setDescription(o.description ?? '');
    setAvatarUrl(o.avatar ?? '');
    setAvatarColor(o.avatarColor ?? '');
    setTags(o.tags ?? []);
  };

  // Esc key handler
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleBack]);

  const connected = React.useMemo(() => {
    if (!conn) return false;
    const refreshTime = new Date(conn.last_refresh as unknown as string);
    if (refreshTime.toString() === 'Invalid Date') return false;
    // eslint-disable-next-line react-hooks/purity -- Date.now() is intentionally impure here
    return refreshTime.getTime() + conn.expiry_time > Date.now();
  }, [conn]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- conn.last_refresh is time.Time (Go wrapper), Date constructor accepts it at runtime
  const formatTime = React.useCallback((timestamp: any): string => {
    if (!timestamp) return 'Never';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- time.Time is opaque but Date() handles it at runtime
    const date = new Date(timestamp);
    if (date.toString() === 'Invalid Date') return 'Never';
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }, []);

  const handleSectionChange = (id: string) => {
    setSearchParams({ section: id }, { replace: true });
  };

  // Cluster card display values
  const cardName = displayName || conn?.name || connectionId;
  const cardBgColor = avatarColor || stringToColor(cardName);
  const cardInitials = getInitials(cardName);

  return (
    <Layout.Root>
      <Layout.SideNav type="bordered" scrollable>
        <Stack direction="column" sx={sidenavColumnSx}>
          {/* Header with back + title + actions */}
          <Stack
            direction="row"
            alignItems="center"
            gap={0.5}
            sx={sidenavHeaderSx}
          >
            <IconButton size="sm" emphasis="ghost" onClick={handleBack}>
              <LuArrowLeft size={16} />
            </IconButton>
            <Text size="sm" weight="semibold" sx={headerTitleSx}>
              Cluster Settings
            </Text>
            {hasDrafts && (
              <>
                <Tooltip title="Discard changes" placement="bottom">
                  <IconButton size="sm" emphasis="ghost" color="neutral" onClick={handleCancel}>
                    <LuX size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Save changes" placement="bottom">
                  <IconButton size="sm" emphasis="ghost" color="primary" onClick={() => { void handleSave(); }}>
                    <LuSave size={16} />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </Stack>

          {/* Cluster card */}
          <Box sx={clusterCardWrapperSx}>
            <Box
              sx={clusterCardSx}
            >
              {avatarUrl ? (
                <Avatar
                  src={avatarUrl}
                  sx={avatarImgSx}
                />
              ) : (
                <MuiAvatar
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 1,
                    bgcolor: cardBgColor,
                    fontSize: '0.875rem',
                  }}
                >
                  {cardInitials}
                </MuiAvatar>
              )}
              <Stack direction="column" gap={0.25} sx={clusterInfoColumnSx}>
                <Text
                  size="sm"
                  weight="semibold"
                  sx={clusterNameSx}
                >
                  {cardName}
                </Text>
                <Stack direction="row" alignItems="center" gap={0.75}>
                  <Chip
                    size="sm"
                    emphasis="soft"
                    color={connected ? 'success' : 'neutral'}
                    startAdornment={<LuCircle size={6} fill="currentColor" />}
                    label={connected ? 'Connected' : 'Disconnected'}
                  />
                </Stack>
              </Stack>
            </Box>
          </Box>

          {/* Nav menu */}
          <NavMenu
            size="sm"
            sections={SECTIONS}
            selected={section}
            onSelect={handleSectionChange}
            sx={navMenuSx}
          />
        </Stack>
      </Layout.SideNav>

      <Layout.Main sx={mainPanelSx}>
        {section === 'identity' && (
          <IdentitySection
            displayName={displayName}
            description={description}
            avatarUrl={avatarUrl}
            avatarColor={avatarColor}
            connName={conn?.name ?? connectionId}
            onDisplayNameChange={setDisplayName}
            onDescriptionChange={setDescription}
            onAvatarUrlChange={setAvatarUrl}
            onAvatarColorChange={setAvatarColor}
          />
        )}
        {section === 'tags' && (
          <TagsSection tags={tags} availableTags={availableTags} onChange={setTags} />
        )}
        {section === 'cluster-info' && conn && (
          <ClusterInfoSection conn={conn} formatTime={formatTime} />
        )}
        {section === 'connection' && conn && (
          <ConnectionSection conn={conn} formatTime={formatTime} />
        )}
        {section === 'metrics' && (
          <SectionWrapper
            title="Metrics"
            description="Configure Prometheus metrics collection for this cluster."
          >
            <MetricsTabContent
              pluginID={meta.id}
              connectionID={connectionId}
              connected={connected}
            />
          </SectionWrapper>
        )}
        {section === 'node-shell' && (
          <SectionWrapper
            title="Node Shell"
            description="Configure the debug pod and shell command used for node access."
          >
            <NodeShellTabContent pluginID={meta.id} connectionID={connectionId} />
          </SectionWrapper>
        )}
      </Layout.Main>
    </Layout.Root>
  );
};

export default ClusterEditPage;
