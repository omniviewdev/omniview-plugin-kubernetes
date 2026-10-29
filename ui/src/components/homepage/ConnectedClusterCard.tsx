import { IconButton } from '@omniviewdev/base-ui';
import { useResources, useResourceMetrics } from '@omniviewdev/runtime';
import type { metric, types  } from '@omniviewdev/runtime/models';
import type { Pod, Event as K8sEvent } from 'kubernetes-types/core/v1';
import React from 'react';
import { LuCircleAlert, LuClock, LuTriangleAlert, LuBox, LuServer, LuLayers, LuPower } from 'react-icons/lu';

import { PLUGIN_ID } from '@/pluginId';

import type { ConnectionOverride } from '../../types/clusters';
import ConnectionStatusBadge from '../connections/ConnectionStatusBadge';
import NamedAvatar from '../shared/NamedAvatar';
import SimpleTooltip from '../shared/SimpleTooltip';

import styles from './ConnectedClusterCard.module.css';


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
  if (pct < 60) return 'var(--ov-color-success)';
  if (pct < 85) return 'var(--ov-color-warning)';
  return 'var(--ov-color-danger)';
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
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={styles.Card}
    >
      {/* Disconnect button — top right */}
      <SimpleTooltip content="Disconnect">
        <IconButton
          className={styles.DisconnectButton}
          size="xs"
          variant="ghost"
          color="neutral"
          aria-label="Disconnect"
          onClick={onDisconnect}
        >
          <LuPower size={14} />
        </IconButton>
      </SimpleTooltip>

      {/* Large avatar — left column */}
      <div style={avatarColumnStyle}>
        <ConnectionStatusBadge isConnected>
          <div className={styles.AvatarBox}>
            {avatar ? (
              <img src={avatar} alt="" style={avatarImageStyle} />
            ) : (
              <NamedAvatar value={displayName} color={avatarColor} />
            )}
          </div>
        </ConnectionStatusBadge>
      </div>

      {/* Right column: name + stats row */}
      <div style={rightColumnStyle}>
        {/* Cluster name */}
        <span style={nameStyle}>
          {displayName}
          {isSyncing && <span style={syncDotStyle} />}
        </span>

        {/* Stats + bars side by side */}
        <div style={statsRowStyle}>
          {/* Health stats */}
          <div style={healthColumnStyle}>
            {hasIssues ? (
              <>
                {failedCount > 0 && (
                  <StatLine icon={<LuCircleAlert size={10} />} label={`${failedCount} failed pod${failedCount > 1 ? 's' : ''}`} color="var(--ov-color-danger)" />
                )}
                {pendingCount > 0 && (
                  <StatLine icon={<LuClock size={10} />} label={`${pendingCount} pending pod${pendingCount > 1 ? 's' : ''}`} color="var(--ov-color-warning)" />
                )}
                {warningCount > 0 && (
                  <StatLine icon={<LuTriangleAlert size={10} />} label={`${warningCount} warning event${warningCount > 1 ? 's' : ''}`} color="var(--ov-color-warning)" />
                )}
              </>
            ) : (
              <StatLine icon={null} label="Healthy" color="var(--ov-color-success)" />
            )}
          </div>

          {/* CPU / Memory vertical bars */}
          {hasMetrics && (
            <div style={barsStyle}>
              <VerticalBar pct={cpuPct} label="CPU" />
              <VerticalBar pct={memPct} label="MEM" />
            </div>
          )}
        </div>
        {/* Resource counts */}
        <div style={countsRowStyle}>
          <CountBadge icon={<LuBox size={11} />} count={podCount} />
          <CountBadge icon={<LuServer size={11} />} count={nodeCount} />
          <CountBadge icon={<LuLayers size={11} />} count={deploymentCount} />
        </div>
      </div>
    </div>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const avatarColumnStyle: React.CSSProperties = { flexShrink: 0, display: 'flex', alignItems: 'center' };
const avatarImageStyle: React.CSSProperties = { width: 52, height: 52, borderRadius: 8, objectFit: 'cover' };
const rightColumnStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  justifyContent: 'center',
};
const nameStyle: React.CSSProperties = {
  fontSize: '0.82rem',
  fontWeight: 600,
  color: 'var(--ov-color-fg-default)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  paddingRight: 20,
};
const syncDotStyle: React.CSSProperties = {
  marginLeft: 6,
  display: 'inline-block',
  width: 6,
  height: 6,
  borderRadius: '50%',
  backgroundColor: 'var(--ov-color-info)',
  verticalAlign: 'middle',
};
const statsRowStyle: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'stretch' };
const healthColumnStyle: React.CSSProperties = { flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 1 };
const barsStyle: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'flex-end', alignSelf: 'stretch' };
const countsRowStyle: React.CSSProperties = { display: 'flex', gap: 12, paddingTop: 2 };

const countBadgeStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 3 };
const countIconStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', color: 'var(--ov-color-fg-subtle)', opacity: 0.7 };
const countTextStyle: React.CSSProperties = { fontSize: '0.7rem', color: 'var(--ov-color-fg-subtle)', fontVariantNumeric: 'tabular-nums' };
const statLineStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 };
const barColumnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 };
const barTrackStyle: React.CSSProperties = {
  position: 'relative',
  width: 8,
  flex: 1,
  minHeight: 24,
  borderRadius: 3,
  backgroundColor: 'var(--ov-color-bg-inset)',
  overflow: 'hidden',
};
const barPctStyle: React.CSSProperties = {
  fontSize: '0.55rem',
  color: 'var(--ov-color-fg-subtle)',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1,
};
const barLabelStyle: React.CSSProperties = {
  fontSize: '0.5rem',
  color: 'var(--ov-color-fg-subtle)',
  opacity: 0.6,
  lineHeight: 1,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const CountBadge: React.FC<{ icon: React.ReactNode; count: number }> = ({ icon, count }) => (
  <div style={countBadgeStyle}>
    <div style={countIconStyle}>{icon}</div>
    <span style={countTextStyle}>{count}</span>
  </div>
);

const StatLine: React.FC<{ icon: React.ReactNode; label: string; color: string }> = ({ icon, label, color }) => (
  <div style={statLineStyle}>
    {icon && <div style={{ display: 'flex', alignItems: 'center', color, flexShrink: 0 }}>{icon}</div>}
    <span style={{ fontSize: '0.7rem', color, lineHeight: 1.3 }}>{label}</span>
  </div>
);

const VerticalBar: React.FC<{ pct: number; label: string }> = ({ pct, label }) => (
  <div style={barColumnStyle}>
    <div style={barTrackStyle}>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: `${Math.min(pct, 100)}%`,
          backgroundColor: pctColor(pct),
          borderRadius: 3,
          transition: 'height 0.4s ease',
        }}
      />
    </div>
    <span style={barPctStyle}>{pct.toFixed(0)}%</span>
    <span style={barLabelStyle}>{label}</span>
  </div>
);

export default ConnectedClusterCard;
