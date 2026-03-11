import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { Deployment } from 'kubernetes-types/apps/v1';
import type { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';

import KVCard from '../../../../../shared/KVCard';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import SidebarSection from '../../../../../shared/SidebarSection';
import WorkloadPortsCard from '../../../../../shared/WorkloadPortsCard';
import WorkloadStatusSection from '../../../../../shared/WorkloadStatusSection';
import { PodContainersSectionFromPodSpec } from '../../../../sidebar/Pod/PodContainersSection';

interface Props {
  ctx: DrawerContext<Deployment>;
}

export const DeploymentSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const dep = ctx.data;
  const spec = dep.spec;
  const status = dep.status;
  const conditions = (status?.conditions || []) as Condition[];
  const paused = spec?.paused;
  const selector = spec?.selector?.matchLabels as Record<string, string> | undefined;
  const strategy = spec?.strategy;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={dep.metadata} />

        <WorkloadStatusSection
          title="Status"
          paused={paused}
          conditions={conditions}
          counts={[
            { label: 'Replicas', value: status?.replicas },
            { label: 'Ready', value: status?.readyReplicas },
            { label: 'Available', value: status?.availableReplicas },
            { label: 'Unavailable', value: status?.unavailableReplicas },
            { label: 'Updated', value: status?.updatedReplicas },
          ]}
        />

        <SidebarSection title="Configuration">
            <LabeledEntry label="Strategy" value={strategy?.type} />
            {strategy?.type === 'RollingUpdate' && strategy.rollingUpdate && (
              <>
                <LabeledEntry label="Max Unavailable" value={String(strategy.rollingUpdate.maxUnavailable ?? '')} />
                <LabeledEntry label="Max Surge" value={String(strategy.rollingUpdate.maxSurge ?? '')} />
              </>
            )}
            <LabeledEntry label="Min Ready Seconds" value={spec?.minReadySeconds !== undefined ? String(spec.minReadySeconds) : undefined} />
            <LabeledEntry label="Revision History" value={spec?.revisionHistoryLimit !== undefined ? String(spec.revisionHistoryLimit) : undefined} />
            <LabeledEntry label="Progress Deadline" value={spec?.progressDeadlineSeconds !== undefined ? `${spec.progressDeadlineSeconds}s` : undefined} />
        </SidebarSection>
      </Stack>

      {selector && Object.keys(selector).length > 0 && (
        <KVCard title="Selector" kvs={selector} defaultExpanded />
      )}

      {dep.spec?.template?.spec && (
        <WorkloadPortsCard
          podSpec={dep.spec.template.spec}
          resourceKey="apps::v1::Deployment"
          resourceData={dep}
          resourceID={ctx.resource?.id || ''}
          connectionID={ctx.resource?.connectionID || ''}
        />
      )}

      <PodContainersSectionFromPodSpec
        resourceID={ctx.resource?.id || ''}
        connectionID={ctx.resource?.connectionID || ''}
        spec={dep.spec?.template?.spec}
      />
    </Stack>
  );
};

DeploymentSidebar.displayName = 'DeploymentSidebar';
export default DeploymentSidebar;
