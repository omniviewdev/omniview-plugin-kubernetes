import { Stack } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import type { StatefulSet } from 'kubernetes-types/apps/v1';
import type { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';

import ExpandableSections, { type ExpandableSection } from '../../../../../shared/ExpandableSections';
import KVCard from '../../../../../shared/KVCard';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';
import SidebarSection from '../../../../../shared/SidebarSection';
import WorkloadPortsCard from '../../../../../shared/WorkloadPortsCard';
import WorkloadStatusSection from '../../../../../shared/WorkloadStatusSection';
import { PodContainersSectionFromPodSpec } from '../../../../sidebar/Pod/PodContainersSection';

const cardContentStyle = { paddingInline: 8, paddingBlock: 4 } as const;

const fullWidthStyle = { width: '100%' } as const;

interface Props {
  ctx: DrawerContext<StatefulSet>;
}

export const StatefulSetSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const sts = ctx.data;
  const connectionID = ctx.resource?.connectionID || '';
  const namespace = sts.metadata?.namespace;
  const spec = sts.spec;
  const status = sts.status;
  const conditions = (status?.conditions || []) as Condition[];
  const selector = spec?.selector?.matchLabels;
  const vcts = spec?.volumeClaimTemplates;
  const retentionPolicy = spec?.persistentVolumeClaimRetentionPolicy;

  return (
    <Stack direction="column" spacing={4} style={fullWidthStyle}>
      <Stack direction="column" spacing={1}>
        <ObjectMetaSection data={sts.metadata} connectionID={ctx.resource?.connectionID} />

        <WorkloadStatusSection
          title="Status"
          conditions={conditions}
          counts={[
            { label: 'Replicas', value: status?.replicas },
            { label: 'Ready', value: status?.readyReplicas },
            { label: 'Available', value: status?.availableReplicas },
            { label: 'Current', value: status?.currentReplicas },
            { label: 'Updated', value: status?.updatedReplicas },
          ]}
        />

        <SidebarSection title="Configuration">
            {spec?.serviceName && (
              <LabeledEntry
                label="Service"
                value={
                  <ResourceLinkChip
                    connectionID={connectionID}
                    namespace={namespace}
                    resourceID={spec.serviceName}
                    resourceKey="core::v1::Service"
                    resourceName={spec.serviceName}
                  />
                }
              />
            )}
            <LabeledEntry label="Pod Management" value={spec?.podManagementPolicy} />
            <LabeledEntry label="Update Strategy" value={spec?.updateStrategy?.type} />
            <LabeledEntry label="Revision History" value={spec?.revisionHistoryLimit !== undefined ? String(spec.revisionHistoryLimit) : undefined} />
            {retentionPolicy && (
              <>
                <LabeledEntry label="When Deleted" value={retentionPolicy.whenDeleted} />
                <LabeledEntry label="When Scaled" value={retentionPolicy.whenScaled} />
              </>
            )}
        </SidebarSection>
      </Stack>

      {selector && Object.keys(selector).length > 0 && (
        <KVCard title="Selector" kvs={selector} defaultExpanded />
      )}

      {vcts && vcts.length > 0 && (
        <ExpandableSections
          sections={vcts.map((vct, i): ExpandableSection => ({
            title: vct.metadata?.name || `VCT ${i + 1}`,
            defaultExpanded: i === 0,
            children: (
              <Stack direction="column" spacing={1} style={cardContentStyle}>
                <LabeledEntry label="Access Modes" value={vct.spec?.accessModes?.join(', ')} />
                <LabeledEntry label="Storage" value={(vct.spec?.resources?.requests)?.storage} />
                <LabeledEntry label="Storage Class" value={vct.spec?.storageClassName} />
              </Stack>
            ),
          }))}
        />
      )}

      {sts.spec?.template?.spec && (
        <WorkloadPortsCard
          podSpec={sts.spec.template.spec}
          resourceKey="apps::v1::StatefulSet"
          resourceData={sts}
          resourceID={ctx.resource?.id || ''}
          connectionID={ctx.resource?.connectionID || ''}
        />
      )}

      <PodContainersSectionFromPodSpec
        resourceID={ctx.resource?.id || ''}
        connectionID={ctx.resource?.connectionID || ''}
        spec={sts.spec?.template?.spec}
      />
    </Stack>
  );
};

StatefulSetSidebar.displayName = 'StatefulSetSidebar';
export default StatefulSetSidebar;
