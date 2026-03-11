import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { HorizontalPodAutoscaler } from 'kubernetes-types/autoscaling/v2';
import { formatRelative } from 'date-fns';
import React from 'react';

import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';
import SidebarSection from '../../../../../shared/SidebarSection';

interface Props {
  ctx: DrawerContext<HorizontalPodAutoscaler>;
}

function resolveResourceKey(kind?: string): string {
  switch (kind) {
    case 'Deployment':
      return 'apps::v1::Deployment';
    case 'StatefulSet':
      return 'apps::v1::StatefulSet';
    case 'ReplicaSet':
      return 'apps::v1::ReplicaSet';
    case 'ReplicationController':
      return 'core::v1::ReplicationController';
    default:
      return `apps::v1::${kind || 'Deployment'}`;
  }
}

export const HorizontalPodAutoscalerSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const hpa = ctx.data;
  const connectionID = ctx.resource?.connectionID || '';
  const namespace = hpa.metadata?.namespace;
  const spec = hpa.spec;
  const status = hpa.status;
  const targetRef = spec?.scaleTargetRef;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={hpa.metadata} />

        {targetRef && (
          <SidebarSection title="Scale Target">
            <LabeledEntry
              label={targetRef.kind || 'Target'}
              value={
                <ResourceLinkChip
                  connectionID={connectionID}
                  namespace={namespace}
                  resourceID={targetRef.name || ''}
                  resourceKey={resolveResourceKey(targetRef.kind)}
                  resourceName={targetRef.name}
                />
              }
            />
          </SidebarSection>
        )}

        <SidebarSection title="Configuration">
          <LabeledEntry
            label="Min Replicas"
            value={spec?.minReplicas !== undefined ? String(spec.minReplicas) : undefined}
          />
          <LabeledEntry
            label="Max Replicas"
            value={spec?.maxReplicas !== undefined ? String(spec.maxReplicas) : undefined}
          />
        </SidebarSection>

        {status && (
          <SidebarSection title="Status">
            <LabeledEntry
              label="Current Replicas"
              value={
                status.currentReplicas !== undefined
                  ? String(status.currentReplicas)
                  : undefined
              }
            />
            <LabeledEntry
              label="Desired Replicas"
              value={
                status.desiredReplicas !== undefined
                  ? String(status.desiredReplicas)
                  : undefined
              }
            />
            {status.lastScaleTime && (
              <LabeledEntry
                label="Last Scale Time"
                value={formatRelative(new Date(status.lastScaleTime), new Date())}
              />
            )}
          </SidebarSection>
        )}
      </Stack>
    </Stack>
  );
};

HorizontalPodAutoscalerSidebar.displayName = 'HorizontalPodAutoscalerSidebar';
export default HorizontalPodAutoscalerSidebar;
