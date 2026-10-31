import { Chip, Spinner, Stack, Text } from '@omniviewdev/base-ui';
import type { NodeCondition, Node as K8sNode, Event as K8sEvent, Pod  } from 'kubernetes-types/core/v1';
import React from 'react';
import { useConnectionMetadata } from '@omniviewdev/runtime';
import ConnectionMetadataValue from '../../../../components/shared/ConnectionMetadataValue';
import ConnectionEnvironment from '../../../../components/shared/ConnectionEnvironment';

const statIconStyle: React.CSSProperties = { display: 'flex', color: 'var(--ov-color-fg-subtle)' };

const statLabelStyle: React.CSSProperties = { fontWeight: 600 };

const cardRowStyle: React.CSSProperties = {
  paddingBlock: 6,
  flexWrap: 'wrap',
  gap: 8,
  borderBottom: '1px solid var(--ov-color-border-muted)',
};

const statListStyle: React.CSSProperties = { minWidth: 0, flexWrap: 'wrap', rowGap: 6 };

const healthChipStyle: React.CSSProperties = { flexShrink: 0, maxWidth: '100%' };

import {
  LuCircleCheck,
  LuCircleX,
  LuCpu,
  LuGlobe,
  LuServer,
  LuTag,
  LuTriangleAlert,
} from 'react-icons/lu';


type Props = {
  connectionID: string;
  loading?: boolean;
  nodes: K8sNode[];
  pods: Pod[];
  events: K8sEvent[];
};


function StatItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Stack direction="row" align="center" spacing={1}>
      <span style={statIconStyle}>{icon}</span>
      <Text size="xs" style={statLabelStyle} truncate>
        {label}
      </Text>
      <Text size="xs" truncate tone="muted">
        {value}
      </Text>
    </Stack>
  );
}

function useHealthStatus(nodes: K8sNode[], pods: Pod[], events: K8sEvent[]) {
  return React.useMemo(() => {
    const unhealthyNodes = nodes.filter((n) => {
      const conditions: NodeCondition[] = n.status?.conditions ?? [];
      const ready = conditions.find((c) => c.type === 'Ready');
      return !ready || ready.status !== 'True';
    });
    const failedPods = pods.filter((p) => p.status?.phase === 'Failed');
    const pendingPods = pods.filter((p) => p.status?.phase === 'Pending');
    const warningEvents = events.filter((e) => e.type === 'Warning');

    const issues: string[] = [];
    if (unhealthyNodes.length > 0)
      issues.push(`${unhealthyNodes.length} node${unhealthyNodes.length > 1 ? 's' : ''} not ready`);
    if (failedPods.length > 0)
      issues.push(`${failedPods.length} failed pod${failedPods.length > 1 ? 's' : ''}`);
    if (pendingPods.length > 0)
      issues.push(`${pendingPods.length} pending pod${pendingPods.length > 1 ? 's' : ''}`);
    if (warningEvents.length > 0)
      issues.push(`${warningEvents.length} warning event${warningEvents.length > 1 ? 's' : ''}`);

    const hasErrors = unhealthyNodes.length > 0 || failedPods.length > 0;
    return { issues, hasErrors };
  }, [nodes, pods, events]);
}

const ClusterInfoCard: React.FC<Props> = ({ connectionID, loading, nodes, pods, events }) => {
  const metadata = useConnectionMetadata('kubernetes', connectionID);
  const fact = (key: string, label: string) => <ConnectionMetadataValue {...metadata} metadataKey={`kubernetes.${key}`} label={label} />;
  const health = useHealthStatus(nodes, pods, events);

  if (loading) {
    return (
      <Stack direction="row" align="center" spacing={2} style={cardRowStyle}>
        <Spinner size="sm" />
      </Stack>
    );
  }

  const healthColor =
    health.issues.length === 0 ? 'success' : health.hasErrors ? 'danger' : 'warning';
  const HealthIcon =
    health.issues.length === 0 ? LuCircleCheck : health.hasErrors ? LuCircleX : LuTriangleAlert;

  return (
    <Stack direction="row" align="center" justify="between" style={cardRowStyle}>
      {/* Left: cluster info + stats with dividers */}
      <Stack direction="row" align="center" divider spacing={3} style={statListStyle}>
        <ConnectionEnvironment {...metadata} />
        <StatItem icon={<LuGlobe size={12} />} label="Cluster" value={fact('server_url', 'API server')} />
        <StatItem
          icon={<LuTag size={12} />}
          label="Version"
          value={fact('server_version', 'Kubernetes version')}
        />
        <StatItem
          icon={<LuCpu size={12} />}
          label="OS / arch"
          value={fact('server_platform', 'Server OS / architecture')}
        />
        <StatItem
          icon={<LuServer size={12} />}
          label="Nodes on selected page"
          value={String(nodes.length)}
        />
      </Stack>

      {/* Right: health chip */}
      <Chip
        size="sm"
        variant="soft"
        color={healthColor}
        startDecorator={<HealthIcon size={12} />}
        style={healthChipStyle}
      >
        {health.issues.length === 0 ? 'No issues observed' : `Issues: ${health.issues.join(' \u00b7 ')}`}
      </Chip>
    </Stack>
  );
};

export default ClusterInfoCard;
