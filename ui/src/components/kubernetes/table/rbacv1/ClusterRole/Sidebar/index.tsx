import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { ClusterRole } from 'kubernetes-types/rbac/v1';
import React from 'react';

// material-ui

// types

// project-imports
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';

interface Props {
  ctx: DrawerContext<ClusterRole>;
}

/**
 * Renders a sidebar for a ClusterRole resource
 */
export const ClusterRoleSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const data = ctx.data;

  // compose your component here
  return (
    <Stack direction="column" width={'100%'} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

ClusterRoleSidebar.displayName = 'ClusterRoleSidebar';
export default ClusterRoleSidebar;
