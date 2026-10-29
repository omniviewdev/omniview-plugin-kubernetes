import { Stack } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import type { ReplicaSet } from 'kubernetes-types/apps/v1';
import type { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';

import KVCard from '../../../../../shared/KVCard';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import WorkloadPortsCard from '../../../../../shared/WorkloadPortsCard';
import WorkloadStatusSection from '../../../../../shared/WorkloadStatusSection';
import { PodContainersSectionFromPodSpec } from '../../../../sidebar/Pod/PodContainersSection';

const fullWidthStyle = { width: '100%' } as const;

interface Props {
  ctx: DrawerContext<ReplicaSet>;
}

export const ReplicaSetSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const rs = ctx.data;
  const spec = rs.spec;
  const status = rs.status;
  const conditions = (status?.conditions || []) as Condition[];
  const selector = spec?.selector?.matchLabels;

  return (
    <Stack direction="column" spacing={4} style={fullWidthStyle}>
      <Stack direction="column" spacing={1}>
        <ObjectMetaSection data={rs.metadata} connectionID={ctx.resource?.connectionID} />

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
