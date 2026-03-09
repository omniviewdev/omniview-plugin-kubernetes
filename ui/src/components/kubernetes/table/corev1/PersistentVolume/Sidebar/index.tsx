import { DrawerContext } from '@omniviewdev/runtime';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import type { PersistentVolume } from 'kubernetes-types/core/v1';
import React from 'react';

import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';
import SidebarSection from '../../../../../shared/SidebarSection';

const chipSx = { borderRadius: 1 } as const;

interface Props {
  ctx: DrawerContext<PersistentVolume>;
}

function phaseColor(phase?: string): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  switch (phase) {
    case 'Available':
      return 'success';
    case 'Bound':
      return 'info';
    case 'Released':
      return 'warning';
    case 'Failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

export const PersistentVolumeSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const pv = ctx.data;
  const connectionID = ctx.resource?.connectionID || '';
  const spec = pv.spec;
  const phase = pv.status?.phase;
  const capacity = spec?.capacity as Record<string, string> | undefined;
  const accessModes = spec?.accessModes;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={pv.metadata} />

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
          <LabeledEntry label="Reclaim Policy" value={spec?.persistentVolumeReclaimPolicy} />
          <LabeledEntry label="Volume Mode" value={spec?.volumeMode} />
        </SidebarSection>

        {(spec?.storageClassName || spec?.claimRef) && (
          <SidebarSection title="Links">
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
            {spec?.claimRef && (
              <LabeledEntry
                label="Claim"
                value={
                  <ResourceLinkChip
                    connectionID={connectionID}
                    namespace={spec.claimRef.namespace}
                    resourceID={spec.claimRef.name || ''}
                    resourceKey="core::v1::PersistentVolumeClaim"
                    resourceName={spec.claimRef.name}
                  />
                }
              />
            )}
          </SidebarSection>
        )}
      </Stack>
    </Stack>
  );
};

PersistentVolumeSidebar.displayName = 'PersistentVolumeSidebar';
export default PersistentVolumeSidebar;
