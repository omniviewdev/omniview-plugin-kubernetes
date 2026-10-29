import { Stack } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import type { StorageClass } from 'kubernetes-types/storage/v1';
import React from 'react';

import KVCard from '../../../../../shared/KVCard';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import SidebarSection from '../../../../../shared/SidebarSection';

const fullWidthStyle = { width: '100%' } as const;

interface Props {
  ctx: DrawerContext<StorageClass>;
}

export const StorageClassSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const sc = ctx.data;
  const params = sc.parameters;

  return (
    <Stack direction="column" spacing={4} style={fullWidthStyle}>
      <Stack direction="column" spacing={1}>
        <ObjectMetaSection data={sc.metadata} connectionID={ctx.resource?.connectionID} />

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
