import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { DaemonSet } from 'kubernetes-types/apps/v1';
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
  ctx: DrawerContext<DaemonSet>;
}

export const DaemonSetSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const ds = ctx.data;
  const spec = ds.spec;
  const status = ds.status;
  const conditions = (status?.conditions || []) as Condition[];
  const selector = spec?.selector?.matchLabels as Record<string, string> | undefined;
  const strategy = spec?.updateStrategy;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={ds.metadata} />

        <WorkloadStatusSection
          title="Status"
          conditions={conditions}
          counts={[
            { label: 'Desired', value: status?.desiredNumberScheduled },
            { label: 'Current', value: status?.currentNumberScheduled },
            { label: 'Ready', value: status?.numberReady },
            { label: 'Available', value: status?.numberAvailable },
            { label: 'Unavailable', value: status?.numberUnavailable },
            { label: 'Misscheduled', value: status?.numberMisscheduled },
          ]}
        />

        <SidebarSection title="Configuration">
            <LabeledEntry label="Update Strategy" value={strategy?.type} />
            {strategy?.type === 'RollingUpdate' && strategy.rollingUpdate && (
              <>
                <LabeledEntry label="Max Unavailable" value={String(strategy.rollingUpdate.maxUnavailable ?? '')} />
                <LabeledEntry label="Max Surge" value={String(strategy.rollingUpdate.maxSurge ?? '')} />
              </>
            )}
            <LabeledEntry label="Min Ready Seconds" value={spec?.minReadySeconds !== undefined ? String(spec.minReadySeconds) : undefined} />
            <LabeledEntry label="Revision History" value={spec?.revisionHistoryLimit !== undefined ? String(spec.revisionHistoryLimit) : undefined} />
        </SidebarSection>
      </Stack>

      {selector && Object.keys(selector).length > 0 && (
        <KVCard title="Selector" kvs={selector} defaultExpanded />
      )}

      {ds.spec?.template?.spec && (
        <WorkloadPortsCard
          podSpec={ds.spec.template.spec}
          resourceKey="apps::v1::DaemonSet"
          resourceData={ds}
          resourceID={ctx.resource?.id || ''}
          connectionID={ctx.resource?.connectionID || ''}
        />
      )}

      <PodContainersSectionFromPodSpec
        resourceID={ctx.resource?.id || ''}
        connectionID={ctx.resource?.connectionID || ''}
        spec={ds.spec?.template?.spec}
      />
    </Stack>
  );
};

DaemonSetSidebar.displayName = 'DaemonSetSidebar';
export default DaemonSetSidebar;
