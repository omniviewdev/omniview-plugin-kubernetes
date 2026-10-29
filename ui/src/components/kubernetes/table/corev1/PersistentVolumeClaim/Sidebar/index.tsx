import { Chip, Stack } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import type { PersistentVolumeClaim } from 'kubernetes-types/core/v1';
import type { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';

import ConditionChip from '../../../../../shared/ConditionChip';
import KVCard from '../../../../../shared/KVCard';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';
import SidebarSection from '../../../../../shared/SidebarSection';

const fullWidthStyle = { width: '100%' } as const;

const chipStyle = { borderRadius: 4 } as const;

interface Props {
  ctx: DrawerContext<PersistentVolumeClaim>;
}

function phaseColor(phase?: string): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (phase) {
    case 'Bound':
      return 'success';
    case 'Pending':
      return 'warning';
    case 'Lost':
      return 'danger';
    default:
      return 'neutral';
  }
}

export const PersistentVolumeClaimSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const pvc = ctx.data;
  const connectionID = ctx.resource?.connectionID || '';
  const spec = pvc.spec;
  const status = pvc.status;
  const phase = status?.phase;
  const conditions = (status?.conditions || []) as Condition[];
  const capacity = status?.capacity;
  const accessModes = spec?.accessModes;
  const storageRequest = (spec?.resources?.requests)
    ?.storage;
  const matchLabels = spec?.selector?.matchLabels;

  return (
    <Stack direction="column" spacing={4} style={fullWidthStyle}>
      <Stack direction="column" spacing={1}>
        <ObjectMetaSection data={pvc.metadata} connectionID={ctx.resource?.connectionID} />

        <SidebarSection
          title="Status"
          headerLeft={
            phase && (
              <Chip size="xs" color={phaseColor(phase)}>{phase}</Chip>
            )
          }
          headerRight={
            conditions.length > 0 ? (
              <Stack direction="row" spacing={1} wrap justify="end">
                {conditions.map((c) => (
                  <ConditionChip key={c.type} condition={c} />
                ))}
              </Stack>
            ) : undefined
          }
        >
          {capacity?.storage && (
            <LabeledEntry label="Capacity" value={capacity.storage} />
          )}
          {accessModes && accessModes.length > 0 && (
            <LabeledEntry
              label="Access Modes"
              value={
                <Stack direction="row" spacing={1} wrap>
                  {accessModes.map((mode) => (
                    <Chip key={mode} size="xs" color="brand" style={chipStyle}>{mode}</Chip>
                  ))}
                </Stack>
              }
            />
          )}
          <LabeledEntry label="Storage Request" value={storageRequest} />
          <LabeledEntry label="Volume Mode" value={spec?.volumeMode} />
        </SidebarSection>

        {(spec?.volumeName || spec?.storageClassName) && (
          <SidebarSection title="Links">
            {spec?.volumeName && (
              <LabeledEntry
                label="Volume"
                value={
                  <ResourceLinkChip
                    connectionID={connectionID}
                    resourceID={spec.volumeName}
                    resourceKey="core::v1::PersistentVolume"
                    resourceName={spec.volumeName}
                  />
                }
              />
            )}
            {spec?.storageClassName && (
              <LabeledEntry
                label="Storage Class"
                value={
                  <ResourceLinkChip
                    connectionID={connectionID}
                    resourceID={spec.storageClassName}
                    resourceKey="storage::v1::StorageClass"
                    resourceName={spec.storageClassName}
                  />
                }
              />
            )}
          </SidebarSection>
        )}
      </Stack>

      {matchLabels && Object.keys(matchLabels).length > 0 && (
        <KVCard title="Selector" kvs={matchLabels} defaultExpanded />
      )}
    </Stack>
  );
};

PersistentVolumeClaimSidebar.displayName = 'PersistentVolumeClaimSidebar';
export default PersistentVolumeClaimSidebar;
