import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { Node as K8sNode, Event as K8sEvent, Pod, NodeCondition  } from 'kubernetes-types/core/v1';
import React from 'react';
import { LuCircleCheck, LuTriangleAlert, LuCircleX } from 'react-icons/lu';

const issueListSx = { flexWrap: 'wrap' } as const;

type Props = {
  nodes: K8sNode[];
  pods: Pod[];
  events: K8sEvent[];
};

const ClusterHealthBanner: React.FC<Props> = ({ nodes, pods, events }) => {
  const health = React.useMemo(() => {
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

  const color = health.issues.length === 0 ? 'success' : health.hasErrors ? 'danger' : 'warning';
  const Icon =
    health.issues.length === 0 ? LuCircleCheck : health.hasErrors ? LuCircleX : LuTriangleAlert;

  if (health.issues.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          py: 0.5,
          px: 1.5,
          borderRadius: 1,
          bgcolor: `${color}.50`,
          border: '1px solid',
          borderColor: `${color}.200`,
        }}
      >
        <Icon size={14} />
        <Text size="xs">All systems operational</Text>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        py: 0.5,
        px: 1.5,
        borderRadius: 1,
        bgcolor: `${color}.50`,
        border: '1px solid',
        borderColor: `${color}.200`,
      }}
    >
      <Icon size={14} />
      <Stack direction="row" gap={2} sx={issueListSx}>
        {health.issues.map((issue) => (
          <Text key={issue} size="xs">
            {issue}
          </Text>
        ))}
      </Stack>
    </Box>
  );
};

export default ClusterHealthBanner;
