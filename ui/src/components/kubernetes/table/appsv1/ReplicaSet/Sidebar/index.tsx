import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { ReplicaSet } from 'kubernetes-types/apps/v1';
import type { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';

import KVCard from '../../../../../shared/KVCard';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import WorkloadPortsCard from '../../../../../shared/WorkloadPortsCard';
import WorkloadStatusSection from '../../../../../shared/WorkloadStatusSection';
import { PodContainersSectionFromPodSpec } from '../../../../sidebar/Pod/PodContainersSection';

interface Props {
  ctx: DrawerContext<ReplicaSet>;
}

export const ReplicaSetSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const rs = ctx.data;
  const spec = rs.spec;
  const status = rs.status;
  const conditions = (status?.conditions || []) as Condition[];
  const selector = spec?.selector?.matchLabels as Record<string, string> | undefined;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={rs.metadata} />

        <WorkloadStatusSection
          title="Status"
          conditions={conditions}
          counts={[
            { label: 'Replicas', value: status?.replicas },
            { label: 'Ready', value: status?.readyReplicas },
            { label: 'Available', value: status?.availableReplicas },
            { label: 'Fully Labeled', value: status?.fullyLabeledReplicas },
          ]}
        />

        <LabeledEntry label="Min Ready Seconds" value={spec?.minReadySeconds !== undefined ? String(spec.minReadySeconds) : undefined} />
      </Stack>

      {selector && Object.keys(selector).length > 0 && (
        <KVCard title="Selector" kvs={selector} defaultExpanded />
      )}

      {rs.spec?.template?.spec && (
        <WorkloadPortsCard
          podSpec={rs.spec.template.spec}
          resourceKey="apps::v1::ReplicaSet"
          resourceData={rs}
          resourceID={ctx.resource?.id || ''}
          connectionID={ctx.resource?.connectionID || ''}
        />
      )}

      <PodContainersSectionFromPodSpec
        resourceID={ctx.resource?.id || ''}
        connectionID={ctx.resource?.connectionID || ''}
        spec={rs.spec?.template?.spec}
      />
    </Stack>
  );
};

ReplicaSetSidebar.displayName = 'ReplicaSetSidebar';
export default ReplicaSetSidebar;
