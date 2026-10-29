import { Stack } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import { PersistentVolumeClaim } from 'kubernetes-types/core/v1';
import React from 'react';

// project-imports
import ObjectMetaSection from '../../shared/ObjectMetaSection';

// types

interface Props {
  ctx: DrawerContext<PersistentVolumeClaim>;
}

export const PersistentVolumeClaimSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const pvc = ctx.data;

  return (
    <Stack direction="column" spacing={2} style={{ width: '100%' }}>
      <ObjectMetaSection data={pvc.metadata} connectionID={ctx.resource?.connectionID} />
      <pre>{JSON.stringify(ctx.data, null, 2)}</pre>;
    </Stack>
  );
};

PersistentVolumeClaimSidebar.displayName = 'PersistentVolumeClaimSidebar';
export default PersistentVolumeClaimSidebar;
