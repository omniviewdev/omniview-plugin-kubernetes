import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { PersistentVolumeClaim } from 'kubernetes-types/core/v1';
import React from 'react';

// material-ui

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
    <Stack direction="column" width={'100%'} spacing={1}>
      <ObjectMetaSection data={pvc.metadata} />
      <pre>{JSON.stringify(ctx.data, null, 2)}</pre>;
    </Stack>
  );
};

PersistentVolumeClaimSidebar.displayName = 'PersistentVolumeClaimSidebar';
export default PersistentVolumeClaimSidebar;
