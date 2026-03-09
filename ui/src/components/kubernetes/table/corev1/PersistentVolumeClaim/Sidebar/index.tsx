import { DrawerContext } from '@omniviewdev/runtime';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import type { PersistentVolumeClaim } from 'kubernetes-types/core/v1';
import type { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';

import ConditionChip from '../../../../../shared/ConditionChip';
import KVCard from '../../../../../shared/KVCard';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';
import SidebarSection from '../../../../../shared/SidebarSection';

const chipSx = { borderRadius: 1 } as const;

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
  const capacity = status?.capacity as Record<string, string> | undefined;
  const accessModes = spec?.accessModes;
  const storageRequest = (spec?.resources?.requests as Record<string, string> | undefined)
    ?.storage;
  const matchLabels = spec?.selector?.matchLabels as Record<string, string> | undefined;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={pvc.metadata} />

        <SidebarSection
          title="Status"
          headerLeft={
            phase && (
              <Chip
                size="xs"
                emphasis="soft"
                color={phaseColor(phase)}
                label={phase}
              />
            )
          }
          headerRight={
            conditions.length > 0 ? (
              <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="flex-end">
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
                <Stack direction="row" gap={0.5} flexWrap="wrap">
                  {accessModes.map((mode) => (
                    <Chip
                      key={mode}
                      size="xs"
                      emphasis="soft"
                      color="primary"
                      label={mode}
                      sx={chipSx}
                    />
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
