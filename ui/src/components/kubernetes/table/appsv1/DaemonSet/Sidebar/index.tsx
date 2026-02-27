import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { DaemonSet } from 'kubernetes-types/apps/v1';
import React from 'react';

// material-ui

// types

// project-imports
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import { PodContainersSectionFromPodSpec } from '../../../../sidebar/Pod/PodContainersSection';

interface Props {
  ctx: DrawerContext<DaemonSet>;
}

/**
 * Renders a sidebar for a DaemonSet resource
 */
export const DaemonSetSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  // compose your component here
  return (
    <Stack direction="column" width={'100%'} spacing={2}>
      <ObjectMetaSection data={ctx.data.metadata} />
      <PodContainersSectionFromPodSpec
        resourceID={ctx.resource?.id || ''}
        connectionID={ctx.resource?.connectionID || ''}
        spec={ctx.data.spec?.template?.spec}
      />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

DaemonSetSidebar.displayName = 'DaemonSetSidebar';
export default DaemonSetSidebar;
