import { Stack } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import type { ReplicationController } from 'kubernetes-types/core/v1';
import type { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';

import KVCard from '../../../../../shared/KVCard';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import WorkloadPortsCard from '../../../../../shared/WorkloadPortsCard';
import WorkloadStatusSection from '../../../../../shared/WorkloadStatusSection';

const fullWidthStyle = { width: '100%' } as const;

interface Props {
  ctx: DrawerContext<ReplicationController>;
}

export const ReplicationControllerSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const rc = ctx.data;
  const status = rc.status;
  const conditions = (status?.conditions || []) as Condition[];
  const selector = rc.spec?.selector;

  return (
    <Stack direction="column" spacing={4} style={fullWidthStyle}>
      <Stack direction="column" spacing={1}>
        <ObjectMetaSection data={rc.metadata} connectionID={ctx.resource?.connectionID} />

        <WorkloadStatusSection
          title="Status"
          conditions={conditions}
          counts={[
            { label: 'Replicas', value: status?.replicas },
            { label: 'Ready', value: status?.readyReplicas },
            { label: 'Available', value: status?.availableReplicas },
          ]}
        />
      </Stack>

      {selector && Object.keys(selector).length > 0 && (
        <KVCard title="Selector" kvs={selector} defaultExpanded />
      )}

      {rc.spec?.template?.spec && (
        <WorkloadPortsCard
          podSpec={rc.spec.template.spec}
          resourceKey="core::v1::ReplicationController"
          resourceData={rc}
          resourceID={ctx.resource?.id || ''}
          connectionID={ctx.resource?.connectionID || ''}
        />
      )}
    </Stack>
  );
};

ReplicationControllerSidebar.displayName = 'ReplicationControllerSidebar';
export default ReplicationControllerSidebar;
