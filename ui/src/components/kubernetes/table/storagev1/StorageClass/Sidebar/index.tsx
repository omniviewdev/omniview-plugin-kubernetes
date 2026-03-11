import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { StorageClass } from 'kubernetes-types/storage/v1';
import React from 'react';

import KVCard from '../../../../../shared/KVCard';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import SidebarSection from '../../../../../shared/SidebarSection';

interface Props {
  ctx: DrawerContext<StorageClass>;
}

export const StorageClassSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const sc = ctx.data;
  const params = sc.parameters as Record<string, string> | undefined;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={sc.metadata} />

        <SidebarSection title="Configuration">
            <LabeledEntry label="Provisioner" value={sc.provisioner} />
            <LabeledEntry label="Reclaim Policy" value={sc.reclaimPolicy} />
            <LabeledEntry label="Volume Binding Mode" value={sc.volumeBindingMode} />
            <LabeledEntry
              label="Allow Expansion"
              value={sc.allowVolumeExpansion ? 'Yes' : 'No'}
            />
            {sc.mountOptions && sc.mountOptions.length > 0 && (
              <LabeledEntry label="Mount Options" value={sc.mountOptions.join(', ')} />
            )}
        </SidebarSection>
      </Stack>

      {params && Object.keys(params).length > 0 && (
        <KVCard title="Parameters" kvs={params} defaultExpanded />
      )}
    </Stack>
  );
};

StorageClassSidebar.displayName = 'StorageClassSidebar';
export default StorageClassSidebar;
