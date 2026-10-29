import { Stack } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import { PersistentVolume } from 'kubernetes-types/core/v1';
import React from 'react';

// project-imports
import ObjectMetaSection from '../../shared/ObjectMetaSection';

// types

interface Props {
  ctx: DrawerContext<PersistentVolume>;
}

export const PersistentVolumeSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const pv = ctx.data;

  return (
    <Stack direction="column" spacing={2} style={{ width: '100%' }}>
      <ObjectMetaSection data={pv.metadata} connectionID={ctx.resource?.connectionID} />
      <pre>{JSON.stringify(ctx.data, null, 2)}</pre>;
    </Stack>
  );
};

PersistentVolumeSidebar.displayName = 'PersistentVolumeSidebar';
export default PersistentVolumeSidebar;
