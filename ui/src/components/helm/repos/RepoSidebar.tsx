import { Card, Chip, IconButton, Input, Separator, Stack, Text } from '@omniviewdev/base-ui';
import {
  DrawerContext,
  useExecuteAction,
  useResources,
  useRightDrawer,
} from '@omniviewdev/runtime';
import React from 'react';
import { LuRefreshCw, LuLink, LuShieldCheck, LuShieldOff } from 'react-icons/lu';

import NamedAvatar from '../../shared/NamedAvatar';

import styles from './RepoSidebar.module.css';

const metaRowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 3fr' };
const metaValueStyle: React.CSSProperties = { fontWeight: 400 };
const chartIconContainerStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: '6px',
  flexShrink: 0,
  backgroundColor: 'var(--ov-color-state-hover)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const chartIconImgStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  objectFit: 'contain',
  borderRadius: '4px',
};
const chartDescriptionStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const chartVersionStyle: React.CSSProperties = { marginTop: 2 };
const chartListContainerStyle: React.CSSProperties = { flex: 1, minHeight: 0, overflow: 'auto' };
const chartsSectionStyle: React.CSSProperties = { flex: 1, minHeight: 0, marginTop: 16 };
const chartsHeaderStyle: React.CSSProperties = { flexShrink: 0 };
const chartDetailColumnStyle: React.CSSProperties = { flex: 1, minWidth: 0 };
const noChartsStyle: React.CSSProperties = { textAlign: 'center', padding: '16px 0' };
const urlTextStyle: React.CSSProperties = { wordBreak: 'break-all' };
const rootStyle: React.CSSProperties = { width: '100%', height: '100%', minHeight: 0 };
const headerCardStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 4,
  flexShrink: 0,
  overflow: 'visible',
};
const fullWidthStyle: React.CSSProperties = { width: '100%' };

// ── types ──

/** Shape of a Helm repository as returned by the backend. */
interface HelmRepo {
  name?: string;
  url?: string;
  type?: string;
  username?: string;
  insecure_skip_tls_verify?: boolean;
}

/** Shape of a chart entry in the chart resource list. */
interface ChartListEntry {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  appVersion?: string;
  icon?: string;
  repository?: string;
}

interface Props {
  ctx: DrawerContext<HelmRepo>;
}

const MetaEntry: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div style={metaRowStyle}>
    <Text tone="muted" size="sm">
      {label}
    </Text>
    <Text style={metaValueStyle} size="sm" as="div">
      {value}
    </Text>
  </div>
);

/** Chart icon with image fallback to NamedAvatar */
const ChartIcon: React.FC<{ icon?: string; name: string }> = ({ icon, name }) => {
  const [failed, setFailed] = React.useState(false);
  if (icon && !failed) {
    return (
      <div style={chartIconContainerStyle}>
        <img src={icon} alt={name} onError={() => setFailed(true)} style={chartIconImgStyle} />
      </div>
    );
  }
  return <NamedAvatar value={name} />;
};

/**
 * Renders a sidebar for a Helm Repository resource.
 * Uses the Chart resource list (cached by React Query) filtered by repository
 * instead of making a separate action call each time.
 */
export const RepoSidebar: React.FC<Props> = ({ ctx }) => {
  const connectionID = ctx.resource?.connectionID ?? '';
  const repoName = ctx.data?.name ?? ctx.resource?.id ?? '';
  const [chartFilter, setChartFilter] = React.useState('');

  const { executeAction, isExecuting } = useExecuteAction({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'helm::v1::Repository',
  });

  // Use the existing Chart resource list — cached by React Query
  const { resources: chartsQuery } = useResources({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'helm::v1::Chart',
    idAccessor: 'id',
  });

  const { showResourceSidebar } = useRightDrawer();

  if (!ctx.data) {
    return null;
  }

  const data = ctx.data;

  // Filter charts by this repository
  // chartsQuery.data?.result is typed as unknown[] from the runtime; cast to expected shape
  const allCharts = (chartsQuery.data?.result ?? []) as ChartListEntry[];
  const repoCharts = allCharts.filter((c) => c.repository === repoName);

  const filteredCharts = chartFilter
    ? repoCharts.filter((c) => {
        const name = (c.name ?? '').toLowerCase();
        const desc = (c.description ?? '').toLowerCase();
        return name.includes(chartFilter.toLowerCase()) || desc.includes(chartFilter.toLowerCase());
      })
    : repoCharts;

  return (
    <Stack direction="column" style={rootStyle}>
      {/* ── Fixed header ── */}
      <Card style={headerCardStyle} variant="outline">
        <Stack direction="column" spacing={2}>
          <Stack direction="row" justify="between" align="center">
            <Stack direction="row" align="center" spacing={2}>
              <Text weight="semibold" size="lg">
                {repoName}
              </Text>
              {data.type === 'oci' && (
                <Chip size="sm" variant="soft" color="info">
                  OCI
                </Chip>
              )}
            </Stack>
            <IconButton
              size="sm"
              variant="outline"
              color="brand"
              disabled={isExecuting}
              onClick={() =>
                void executeAction({
                  actionID: 'refresh',
                  id: repoName,
                })
              }
              title="Refresh Repository"
              aria-label="Refresh Repository"
            >
              <LuRefreshCw />
            </IconButton>
          </Stack>
          <Separator />
          <MetaEntry
            label="URL"
            value={
              <Stack direction="row" align="center" spacing={1}>
                <LuLink size={12} />
                <Text size="sm" style={urlTextStyle}>
                  {data.url ?? '—'}
                </Text>
              </Stack>
            }
          />
          {data.username && <MetaEntry label="Username" value={data.username} />}
          <MetaEntry
            label="TLS"
            value={
              <Chip
                size="sm"
                variant="soft"
                color={data.insecure_skip_tls_verify ? 'warning' : 'success'}
                startDecorator={
                  data.insecure_skip_tls_verify ? (
                    <LuShieldOff size={12} />
                  ) : (
                    <LuShieldCheck size={12} />
                  )
                }
              >
                {data.insecure_skip_tls_verify ? 'Insecure' : 'Verified'}
              </Chip>
            }
          />
        </Stack>
      </Card>

      {/* ── Charts section — fills remaining space ── */}
      <Stack direction="column" spacing={2} style={chartsSectionStyle}>
        <Stack direction="row" justify="between" align="center" style={chartsHeaderStyle}>
          <Text weight="semibold" size="sm">
            Charts in this repository ({repoCharts.length})
          </Text>
        </Stack>

        {/* Search */}
        <Input.Control
          value={chartFilter}
          onChange={(e) => setChartFilter(e.target.value)}
          placeholder="Filter charts..."
          aria-label="Filter charts"
          size="sm"
          style={fullWidthStyle}
          autoComplete="off"
        />

        {/* Chart list — scrolls within remaining space */}
        <Stack direction="column" spacing={1} style={chartListContainerStyle}>
          {filteredCharts.map((chart) => (
            <Card
              key={chart.id ?? chart.name ?? ''}
              className={styles.chartCard}
              variant="outline"
              onClick={() => {
                void showResourceSidebar({
                  pluginID: 'kubernetes',
                  connectionID,
                  resourceKey: 'helm::v1::Chart',
                  resourceID: chart.id ?? '',
                });
              }}
            >
              <Stack direction="row" spacing={3} align="start">
                <ChartIcon icon={chart.icon} name={chart.name ?? ''} />
                <Stack direction="column" spacing={0} style={chartDetailColumnStyle}>
                  <Text weight="semibold" size="sm">
                    {chart.name ?? ''}
                  </Text>
                  {chart.description && (
                    <Text size="xs" tone="muted" style={chartDescriptionStyle}>
                      {chart.description}
                    </Text>
                  )}
                  <Text size="xs" tone="subtle" style={chartVersionStyle}>
                    v{chart.version ?? ''}
                    {chart.appVersion ? ` · App: ${chart.appVersion}` : ''}
                  </Text>
                </Stack>
              </Stack>
            </Card>
          ))}
          {chartsQuery.isSuccess && filteredCharts.length === 0 && (
            <Text as="p" size="sm" tone="muted" style={noChartsStyle}>
              {chartFilter
                ? 'No charts match the filter'
                : data.type === 'oci'
                  ? 'OCI registries do not provide a chart index. Reference charts directly by their OCI URL.'
                  : 'No charts found. Try refreshing the repository.'}
            </Text>
          )}
          {chartsQuery.isLoading && (
            <Text as="p" size="sm" tone="muted" style={noChartsStyle}>
              Loading charts...
            </Text>
          )}
        </Stack>
      </Stack>
    </Stack>
  );
};

RepoSidebar.displayName = 'RepoSidebar';
export default RepoSidebar;
