import { useResources } from '@omniviewdev/runtime';
import React from 'react';
import {
  LuBox,
  LuCalendarClock,
  LuContainer,
  LuDatabase,
  LuListChecks,
  LuNetwork,
} from 'react-icons/lu';

import WorkloadSummaryCard from './WorkloadSummaryCard';

type KubeResource = Record<string, any>;

function filterByNamespace(resources: KubeResource[], namespaces: string[]): KubeResource[] {
  if (namespaces.length === 0) return resources;
  return resources.filter((r) => namespaces.includes(r.metadata?.namespace));
}

// --- Module-level icon constants ---
const ICON_POD = <LuContainer size={14} />;
const ICON_DEPLOY = <LuBox size={14} />;
const ICON_STS = <LuDatabase size={14} />;
const ICON_DS = <LuNetwork size={14} />;
const ICON_JOB = <LuListChecks size={14} />;
const ICON_CRONJOB = <LuCalendarClock size={14} />;

type CardProps = {
  connectionID: string;
  namespaces: string[];
  onClick: () => void;
};

export const PodStatCard = React.memo(function PodStatCard({
  connectionID,
  namespaces,
  onClick,
}: CardProps) {
  const { resources: pods } = useResources({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'core::v1::Pod',
    idAccessor: 'metadata.uid',
  });

  const stats = React.useMemo(() => {
    const all = filterByNamespace(pods.data?.result ?? [], namespaces);
    const counts = { Running: 0, Pending: 0, Failed: 0, Succeeded: 0, Unknown: 0 };
    for (const p of all) {
      const phase = p.status?.phase ?? 'Unknown';
      if (phase in counts) {
        counts[phase as keyof typeof counts]++;
      } else {
        counts.Unknown++;
      }
    }
    return {
      total: all.length,
      statuses: [
        { label: 'Running', count: counts.Running, color: 'success' as const },
        { label: 'Pending', count: counts.Pending, color: 'warning' as const },
        { label: 'Failed', count: counts.Failed, color: 'danger' as const },
        { label: 'Succeeded', count: counts.Succeeded, color: 'neutral' as const },
        { label: 'Unknown', count: counts.Unknown, color: 'neutral' as const },
      ],
    };
  }, [pods.data, namespaces]);

  return (
    <WorkloadSummaryCard
      title="Pods"
      icon={ICON_POD}
      total={stats.total}
      statuses={stats.statuses}
      loading={pods.isLoading}
      onClick={onClick}
    />
  );
});

export const DeploymentStatCard = React.memo(function DeploymentStatCard({
  connectionID,
  namespaces,
  onClick,
}: CardProps) {
  const { resources: deployments } = useResources({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'apps::v1::Deployment',
    idAccessor: 'metadata.uid',
  });

  const stats = React.useMemo(() => {
    const all = filterByNamespace(deployments.data?.result ?? [], namespaces);
    let ready = 0;
    let unavailable = 0;
    for (const d of all) {
      const avail = d.status?.availableReplicas ?? 0;
      const desired = d.spec?.replicas ?? 0;
      if (avail >= desired && desired > 0) {
        ready++;
      } else {
        unavailable++;
      }
    }
    return {
      total: all.length,
      statuses: [
        { label: 'Ready', count: ready, color: 'success' as const },
        { label: 'Unavailable', count: unavailable, color: 'danger' as const },
      ],
    };
  }, [deployments.data, namespaces]);

  return (
    <WorkloadSummaryCard
      title="Deployments"
      icon={ICON_DEPLOY}
      total={stats.total}
      statuses={stats.statuses}
      loading={deployments.isLoading}
      onClick={onClick}
    />
  );
});

export const StatefulSetStatCard = React.memo(function StatefulSetStatCard({
  connectionID,
  namespaces,
  onClick,
}: CardProps) {
  const { resources: statefulSets } = useResources({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'apps::v1::StatefulSet',
    idAccessor: 'metadata.uid',
  });

  const stats = React.useMemo(() => {
    const all = filterByNamespace(statefulSets.data?.result ?? [], namespaces);
    let ready = 0;
    let notReady = 0;
    for (const s of all) {
      const readyReplicas = s.status?.readyReplicas ?? 0;
      const desired = s.spec?.replicas ?? 0;
      if (readyReplicas >= desired && desired > 0) {
        ready++;
      } else {
        notReady++;
      }
    }
    return {
      total: all.length,
      statuses: [
        { label: 'Ready', count: ready, color: 'success' as const },
        { label: 'Not Ready', count: notReady, color: 'danger' as const },
      ],
    };
  }, [statefulSets.data, namespaces]);

  return (
    <WorkloadSummaryCard
      title="StatefulSets"
      icon={ICON_STS}
      total={stats.total}
      statuses={stats.statuses}
      loading={statefulSets.isLoading}
      onClick={onClick}
    />
  );
});

export const DaemonSetStatCard = React.memo(function DaemonSetStatCard({
  connectionID,
  namespaces,
  onClick,
}: CardProps) {
  const { resources: daemonSets } = useResources({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'apps::v1::DaemonSet',
    idAccessor: 'metadata.uid',
  });

  const stats = React.useMemo(() => {
    const all = filterByNamespace(daemonSets.data?.result ?? [], namespaces);
    let ready = 0;
    let notReady = 0;
    for (const d of all) {
      const desired = d.status?.desiredNumberScheduled ?? 0;
      const numberReady = d.status?.numberReady ?? 0;
      if (numberReady >= desired && desired > 0) {
        ready++;
      } else {
        notReady++;
      }
    }
    return {
      total: all.length,
      statuses: [
        { label: 'Ready', count: ready, color: 'success' as const },
        { label: 'Not Ready', count: notReady, color: 'danger' as const },
      ],
    };
  }, [daemonSets.data, namespaces]);

  return (
    <WorkloadSummaryCard
      title="DaemonSets"
      icon={ICON_DS}
      total={stats.total}
      statuses={stats.statuses}
      loading={daemonSets.isLoading}
      onClick={onClick}
    />
  );
});

export const JobStatCard = React.memo(function JobStatCard({
  connectionID,
  namespaces,
  onClick,
}: CardProps) {
  const { resources: jobs } = useResources({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'batch::v1::Job',
    idAccessor: 'metadata.uid',
  });

  const stats = React.useMemo(() => {
    const all = filterByNamespace(jobs.data?.result ?? [], namespaces);
    let complete = 0;
    let active = 0;
    let failed = 0;
    for (const j of all) {
      const conditions = j.status?.conditions ?? [];
      const isComplete = conditions.some((c: any) => c.type === 'Complete' && c.status === 'True');
      const isFailed = conditions.some((c: any) => c.type === 'Failed' && c.status === 'True');
      if (isComplete) {
        complete++;
      } else if (isFailed) {
        failed++;
      } else {
        active++;
      }
    }
    return {
      total: all.length,
      statuses: [
        { label: 'Complete', count: complete, color: 'success' as const },
        { label: 'Active', count: active, color: 'warning' as const },
        { label: 'Failed', count: failed, color: 'danger' as const },
      ],
    };
  }, [jobs.data, namespaces]);

  return (
    <WorkloadSummaryCard
      title="Jobs"
      icon={ICON_JOB}
      total={stats.total}
      statuses={stats.statuses}
      loading={jobs.isLoading}
      onClick={onClick}
    />
  );
});

export const CronJobStatCard = React.memo(function CronJobStatCard({
  connectionID,
  namespaces,
  onClick,
}: CardProps) {
  const { resources: cronJobs } = useResources({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'batch::v1::CronJob',
    idAccessor: 'metadata.uid',
  });

  const stats = React.useMemo(() => {
    const all = filterByNamespace(cronJobs.data?.result ?? [], namespaces);
    let activeCount = 0;
    let suspended = 0;
    for (const cj of all) {
      if (cj.spec?.suspend) {
        suspended++;
      } else {
        activeCount++;
      }
    }
    return {
      total: all.length,
      statuses: [
        { label: 'Active', count: activeCount, color: 'success' as const },
        { label: 'Suspended', count: suspended, color: 'neutral' as const },
      ],
    };
  }, [cronJobs.data, namespaces]);

  return (
    <WorkloadSummaryCard
      title="CronJobs"
      icon={ICON_CRONJOB}
      total={stats.total}
      statuses={stats.statuses}
      loading={cronJobs.isLoading}
      onClick={onClick}
    />
  );
});
