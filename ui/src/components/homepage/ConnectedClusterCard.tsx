import React from 'react';
import Box from '@mui/material/Box';

import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import { LuCircleAlert, LuClock, LuTriangleAlert, LuBox, LuServer, LuLayers } from 'react-icons/lu';
import { Avatar } from '@omniviewdev/ui';
import { useResources, useResourceMetrics } from '@omniviewdev/runtime';
import type { metric } from '@omniviewdev/runtime/models';
import type { Pod, Event as K8sEvent } from 'kubernetes-types/core/v1';
import type { ConnectionOverride } from '../../types/clusters';
import type { types } from '@omniviewdev/runtime/models';
import ConnectionStatusBadge from '../connections/ConnectionStatusBadge';
import NamedAvatar from '../shared/NamedAvatar';
const PLUGIN_ID = 'kubernetes';

const METRIC_IDS = [
  'prom_cluster_cpu_utilization',
  'prom_cluster_memory_utilization',
  'prom_cluster_cpu_cores',
  'prom_cluster_memory_total',
];

function extractCurrentValues(
  data: Record<string, metric.QueryResponse> | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!data) return out;
  for (const resp of Object.values(data)) {
    if (!resp?.success || !resp.results) continue;
    for (const result of resp.results) {
      if (result.current_value?.metric_id) {
        out.set(result.current_value.metric_id, result.current_value.value ?? 0);
      }
    }
  }
  return out;
}

function pctColor(pct: number): string {
  if (pct < 60) return 'var(--ov-palette-success-main, #22c55e)';
  if (pct < 85) return 'var(--ov-palette-warning-main, #f59e0b)';
  return 'var(--ov-palette-error-main, #ef4444)';
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  connectionID: string;
  conn: types.Connection | undefined;
  override?: ConnectionOverride;
  isSyncing?: boolean;
  hasErrors?: boolean;
  onClick: () => void;
  onDisconnect: (e: React.MouseEvent) => void;
};

// ── Component ─────────────────────────────────────────────────────────────────

const ConnectedClusterCard: React.FC<Props> = ({
  connectionID,
  conn,
  override,
  isSyncing,
  hasErrors = false,
  onClick,
  onDisconnect,
}) => {
  const displayName = override?.displayName ?? conn?.name ?? connectionID;
  const avatar = override?.avatar ?? conn?.avatar;
  const avatarColor = override?.avatarColor;

  const { resources: podsQuery } = useResources({
    pluginID: PLUGIN_ID,
    connectionID,
    resourceKey: 'core::v1::Pod',
    idAccessor: 'metadata.uid',
  });

  const { resources: eventsQuery } = useResources({
    pluginID: PLUGIN_ID,
    connectionID,
    resourceKey: 'core::v1::Event',
    idAccessor: 'metadata.uid',
  });

  const { resources: nodesQuery } = useResources({
    pluginID: PLUGIN_ID,
    connectionID,
    resourceKey: 'core::v1::Node',
    idAccessor: 'metadata.uid',
  });

  const { resources: deploymentsQuery } = useResources({
    pluginID: PLUGIN_ID,
    connectionID,
    resourceKey: 'apps::v1::Deployment',
    idAccessor: 'metadata.uid',
  });

  const metricConfig = override?.metricConfig;

  const resourceData = React.useMemo(() => {
    if (!metricConfig?.prometheusService && !metricConfig?.prometheusNamespace && !metricConfig?.prometheusPort) {
      return {};
    }
    return {
      __metric_config__: {
        service: metricConfig.prometheusService ?? '',
        namespace: metricConfig.prometheusNamespace ?? '',
        port: metricConfig.prometheusPort ?? 0,
      },
    };
  }, [metricConfig]);

  const { data: metricsData, providers } = useResourceMetrics({
    pluginID: PLUGIN_ID,
    connectionID,
    resourceKey: 'cluster::metrics',
    resourceID: '',
    resourceData,
    shape: 0,
    metricIDs: METRIC_IDS,
    refreshInterval: 30_000,
  });

  const { failedCount, pendingCount, warningCount, podCount, nodeCount, deploymentCount } = React.useMemo(() => {
    const pods = (podsQuery.data?.result ?? []) as Pod[];
    const events = (eventsQuery.data?.result ?? []) as unknown as K8sEvent[];
    return {
      failedCount: pods.filter((p) => p.status?.phase === 'Failed').length,
      pendingCount: pods.filter((p) => p.status?.phase === 'Pending').length,
      warningCount: events.filter((e) => e.type === 'Warning').length,
      podCount: pods.length,
      nodeCount: (nodesQuery.data?.result ?? []).length,
      deploymentCount: (deploymentsQuery.data?.result ?? []).length,
    };
  }, [podsQuery.data, eventsQuery.data, nodesQuery.data, deploymentsQuery.data]);

  const values = React.useMemo(() => extractCurrentValues(metricsData), [metricsData]);
  const hasMetrics = providers.length > 0 && values.size > 0;
  const cpuPct = values.get('prom_cluster_cpu_utilization') ?? 0;
  const memPct = values.get('prom_cluster_memory_utilization') ?? 0;

  const hasIssues = hasErrors || failedCount > 0 || pendingCount > 0 || warningCount > 0;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        gap: 1.5,
        p: 1.25,
        borderRadius: '8px',
        border: '1px solid var(--ov-border-default, rgba(255,255,255,0.08))',
        bgcolor: 'var(--ov-bg-surface, rgba(255,255,255,0.03))',
        transition: 'border-color 0.15s, background-color 0.15s',
        cursor: 'pointer',
        '&:hover': {
          borderColor: 'var(--ov-border-emphasis, rgba(255,255,255,0.15))',
          bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))',
        },
        '&:hover .disconnect-btn': { opacity: 1 },
        '&:focus-visible': {
          outline: '2px solid var(--ov-palette-primary-main, #3b82f6)',
          outlineOffset: '2px',
        },
      }}
    >
      {/* Disconnect button — top right */}
      <Tooltip title="Disconnect">
        <IconButton
          className="disconnect-btn"
          size="small"
          onClick={onDisconnect}
          sx={{
            position: 'absolute',
            top: 6,
            right: 6,
            opacity: 0,
            transition: 'opacity 0.15s',
            p: 0.375,
          }}
        >
          <PowerSettingsNewIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>

      {/* Large avatar — left column */}
      <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <ConnectionStatusBadge isConnected>
          <Box
            sx={{
              width: 52,
              height: 52,
              borderRadius: '8px',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              '& > *': { width: '100% !important', height: '100% !important', fontSize: '1.25rem !important' },
            }}
          >
            {avatar ? (
              <Avatar src={avatar} sx={{ width: 52, height: 52, borderRadius: '8px', bgcolor: 'transparent' }} />
            ) : (
              <NamedAvatar value={displayName} color={avatarColor} />
            )}
          </Box>
        </ConnectionStatusBadge>
      </Box>

      {/* Right column: name + stats row */}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.375, justifyContent: 'center' }}>
        {/* Cluster name */}
        <Box
          component="span"
          sx={{
            fontSize: '0.82rem',
            fontWeight: 600,
            color: 'var(--ov-fg-base)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            pr: 2.5,
          }}
        >
          {displayName}
          {isSyncing && (
            <Box
              component="span"
              sx={{ ml: 0.75, display: 'inline-block', width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--ov-palette-info-main, #3b82f6)', verticalAlign: 'middle' }}
            />
          )}
        </Box>

        {/* Stats + bars side by side */}
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'stretch' }}>
          {/* Health stats */}
          <Box sx={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 0.125 }}>
            {hasIssues ? (
              <>
                {failedCount > 0 && (
                  <StatLine icon={<LuCircleAlert size={10} />} label={`${failedCount} failed pod${failedCount > 1 ? 's' : ''}`} color="var(--ov-palette-error-main, #ef4444)" />
                )}
                {pendingCount > 0 && (
                  <StatLine icon={<LuClock size={10} />} label={`${pendingCount} pending pod${pendingCount > 1 ? 's' : ''}`} color="var(--ov-palette-warning-main, #f59e0b)" />
                )}
                {warningCount > 0 && (
                  <StatLine icon={<LuTriangleAlert size={10} />} label={`${warningCount} warning event${warningCount > 1 ? 's' : ''}`} color="var(--ov-palette-warning-main, #f59e0b)" />
                )}
              </>
            ) : (
              <StatLine icon={null} label="Healthy" color="var(--ov-palette-success-main, #22c55e)" />
            )}
          </Box>

          {/* CPU / Memory vertical bars */}
          {hasMetrics && (
            <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-end', alignSelf: 'stretch' }}>
              <VerticalBar pct={cpuPct} label="CPU" />
              <VerticalBar pct={memPct} label="MEM" />
            </Box>
          )}
        </Box>
        {/* Resource counts */}
        <Box sx={{ display: 'flex', gap: 1.5, pt: 0.25 }}>
          <CountBadge icon={<LuBox size={11} />} count={podCount} />
          <CountBadge icon={<LuServer size={11} />} count={nodeCount} />
          <CountBadge icon={<LuLayers size={11} />} count={deploymentCount} />
        </Box>
      </Box>
    </Box>
  );
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const CountBadge: React.FC<{ icon: React.ReactNode; count: number }> = ({ icon, count }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', color: 'var(--ov-fg-faint)', opacity: 0.7 }}>{icon}</Box>
    <Box component="span" sx={{ fontSize: '0.7rem', color: 'var(--ov-fg-faint)', fontVariantNumeric: 'tabular-nums' }}>{count}</Box>
  </Box>
);

const StatLine: React.FC<{ icon: React.ReactNode; label: string; color: string }> = ({ icon, label, color }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
    {icon && <Box sx={{ display: 'flex', alignItems: 'center', color, flexShrink: 0 }}>{icon}</Box>}
    <Box component="span" sx={{ fontSize: '0.7rem', color, lineHeight: 1.3 }}>{label}</Box>
  </Box>
);

const VerticalBar: React.FC<{ pct: number; label: string }> = ({ pct, label }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
    <Box
      sx={{
        position: 'relative',
        width: 8,
        flex: 1,
        minHeight: 24,
        borderRadius: '3px',
        bgcolor: 'rgba(255,255,255,0.06)',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: `${Math.min(pct, 100)}%`,
          bgcolor: pctColor(pct),
          borderRadius: '3px',
          transition: 'height 0.4s ease',
        }}
      />
    </Box>
    <Box component="span" sx={{ fontSize: '0.55rem', color: 'var(--ov-fg-faint)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
      {pct.toFixed(0)}%
    </Box>
    <Box component="span" sx={{ fontSize: '0.5rem', color: 'var(--ov-fg-faint)', opacity: 0.6, lineHeight: 1, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
      {label}
    </Box>
  </Box>
);

export default ConnectedClusterCard;
