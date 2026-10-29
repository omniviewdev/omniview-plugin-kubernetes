import { Avatar, Chip, IconButton, NavList, Stack, Text } from '@omniviewdev/base-ui';
import { usePluginContext, useConnection } from '@omniviewdev/runtime';
import React from 'react';
import { LuArrowLeft, LuCircle, LuSave, LuX } from 'react-icons/lu';
import { useParams, useNavigate, useSearchParams } from 'react-router';

import MetricsTabContent from '../../components/settings/MetricsTabContent';
import NodeShellTabContent from '../../components/settings/NodeShellTabContent';
import SimpleTooltip from '../../components/shared/SimpleTooltip';
import { useClusterPreferences } from '../../hooks/useClusterPreferences';
import Layout from '../../layouts/resource';
import type { ConnectionOverride } from '../../types/clusters';
import { getInitials } from '../../utils/avatarUtils';
import { stringToColor } from '../../utils/color';

import ClusterInfoSection from './ClusterInfoSection';
import ConnectionSection from './ConnectionSection';
import {
  type SectionId,
  SECTIONS,
  sidenavHeaderStyle,
  clusterCardWrapperStyle,
  clusterCardStyle,
  avatarImgStyle,
  avatarFallbackStyle,
  navMenuStyle,
  sidenavColumnStyle,
  headerTitleStyle,
  clusterInfoColumnStyle,
  mainPanelStyle,
} from './constants';
import IdentitySection from './IdentitySection';
import SectionWrapper from './SectionWrapper';
import TagsSection from './TagsSection';

const ClusterEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const connectionId = id ? decodeURIComponent(id) : '';
  const { meta } = usePluginContext();
  return <ClusterEditForm key={JSON.stringify([meta.id, connectionId])} connectionId={connectionId} />;
};

const ClusterEditForm: React.FC<{ connectionId: string }> = ({ connectionId }) => {
  const { meta } = usePluginContext();
  const rrNavigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = (searchParams.get('section') ?? 'identity') as SectionId;

  const { connection } = useConnection({ pluginID: meta.id, connectionID: connectionId });
  const { connectionOverrides, availableTags, updateOverride } = useClusterPreferences(meta.id);

  const existing = connectionOverrides[connectionId] ?? {};
  const conn = connection.data;

  // Only edited fields belong to this connection's draft. Loaded preferences
  // remain authoritative for untouched fields, including after an async load.
  const [draft, setDraft] = React.useState<Partial<ConnectionOverride>>({});
  const displayName = draft.displayName ?? existing.displayName ?? '';
  const description = draft.description ?? existing.description ?? '';
  const avatarUrl = draft.avatar ?? existing.avatar ?? '';
  const avatarColor = draft.avatarColor ?? existing.avatarColor ?? '';
  const tags = draft.tags ?? existing.tags ?? [];

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
    setDraft({});
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
    const refreshTime = new Date(conn.last_refresh);
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

  const selectedKeys = React.useMemo(() => new Set<string>([section]), [section]);
  const handleSelectedKeysChange = (keys: ReadonlySet<string | number>) => {
    const next = keys.values().next().value;
    if (next != null) handleSectionChange(String(next));
  };

  return (
    <Layout.Root>
      <Layout.SideNav type="bordered" scrollable>
        <Stack direction="column" spacing={0} style={sidenavColumnStyle}>
          {/* Header with back + title + actions */}
          <Stack direction="row" align="center" spacing={1} style={sidenavHeaderStyle}>
            <IconButton size="sm" variant="ghost" color="neutral" aria-label="Back" onClick={handleBack}>
              <LuArrowLeft size={16} />
            </IconButton>
            <Text size="sm" weight="semibold" style={headerTitleStyle}>
              Cluster Settings
            </Text>
            {hasDrafts && (
              <>
                <SimpleTooltip content="Discard changes" placement="bottom">
                  <IconButton size="sm" variant="ghost" color="neutral" aria-label="Discard changes" onClick={handleCancel}>
                    <LuX size={16} />
                  </IconButton>
                </SimpleTooltip>
                <SimpleTooltip content="Save changes" placement="bottom">
                  <IconButton
                    size="sm"
                    variant="ghost"
                    color="brand"
                    aria-label="Save changes"
                    onClick={() => { void handleSave(); }}
                  >
                    <LuSave size={16} />
                  </IconButton>
                </SimpleTooltip>
              </>
            )}
          </Stack>

          {/* Cluster card */}
          <div style={clusterCardWrapperStyle}>
            <div style={clusterCardStyle}>
              {avatarUrl ? (
                <Avatar src={avatarUrl} alt={cardName} shape="rounded" style={avatarImgStyle} />
              ) : (
                <div style={{ ...avatarFallbackStyle, background: cardBgColor }} aria-hidden>
                  {cardInitials}
                </div>
              )}
              <Stack direction="column" spacing={0} style={{ ...clusterInfoColumnStyle, gap: 2 }}>
                <Text size="sm" weight="semibold" truncate>
                  {cardName}
                </Text>
                <Stack direction="row" align="center" spacing={3}>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={connected ? 'success' : 'neutral'}
                    startDecorator={<LuCircle size={6} fill="currentColor" />}
                  >
                    {connected ? 'Connected' : 'Disconnected'}
                  </Chip>
                </Stack>
              </Stack>
            </div>
          </div>

          {/* Nav menu */}
          <NavList
            size="sm"
            selectionMode="single"
            selectedKeys={selectedKeys}
            onSelectedKeysChange={handleSelectedKeysChange}
            aria-label="Cluster settings sections"
            style={navMenuStyle}
          >
            <NavList.Viewport>
              {SECTIONS.map((group) => (
                <NavList.Group key={group.title}>
                  <NavList.GroupHeader>{group.title}</NavList.GroupHeader>
                  <NavList.GroupItems>
                    {group.items.map((item) => (
                      <NavList.Item key={item.id} itemKey={item.id} textValue={item.label} disabled={item.disabled}>
                        {item.icon && <NavList.ItemIcon>{item.icon}</NavList.ItemIcon>}
                        <NavList.ItemLabel>{item.label}</NavList.ItemLabel>
                      </NavList.Item>
                    ))}
                  </NavList.GroupItems>
                </NavList.Group>
              ))}
            </NavList.Viewport>
          </NavList>
        </Stack>
      </Layout.SideNav>

      <Layout.Main style={mainPanelStyle}>
        {section === 'identity' && (
          <IdentitySection
            displayName={displayName}
            description={description}
            avatarUrl={avatarUrl}
            avatarColor={avatarColor}
            connName={conn?.name ?? connectionId}
            onDisplayNameChange={(value) => setDraft((prev) => ({ ...prev, displayName: value }))}
            onDescriptionChange={(value) => setDraft((prev) => ({ ...prev, description: value }))}
            onAvatarUrlChange={(value) => setDraft((prev) => ({ ...prev, avatar: value }))}
            onAvatarColorChange={(value) => setDraft((prev) => ({ ...prev, avatarColor: value }))}
          />
        )}
        {section === 'tags' && (
          <TagsSection tags={tags} availableTags={availableTags} onChange={(value) => setDraft((prev) => ({ ...prev, tags: value }))} />
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
