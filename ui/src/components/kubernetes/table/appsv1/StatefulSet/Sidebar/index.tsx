import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { StatefulSet } from 'kubernetes-types/apps/v1';
import React from 'react';

// material-ui

// types

// project-imports
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import { PodContainersSectionFromPodSpec } from '../../../../sidebar/Pod/PodContainersSection';

interface Props {
  ctx: DrawerContext<StatefulSet>;
}

/**
 * Renders a sidebar for a StatefulSet resource
 */
export const StatefulSetSidebar: React.FC<Props> = ({ ctx }) => {
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

StatefulSetSidebar.displayName = 'StatefulSetSidebar';
export default StatefulSetSidebar;
