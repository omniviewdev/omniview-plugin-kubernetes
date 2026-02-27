import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { PersistentVolume } from 'kubernetes-types/core/v1';
import React from 'react';

// material-ui

// project-imports

// types

import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';

interface Props {
  ctx: DrawerContext<PersistentVolume>;
}

export const PersistentVolumeSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  return (
    <Stack direction="column" width={'100%'} spacing={1}>
      <ObjectMetaSection data={ctx.data.metadata} />
    </Stack>
  );
};

PersistentVolumeSidebar.displayName = 'PersistentVolumeSidebar';
export default PersistentVolumeSidebar;
