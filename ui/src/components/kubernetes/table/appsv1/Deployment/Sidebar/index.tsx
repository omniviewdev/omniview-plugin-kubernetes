import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { Deployment } from 'kubernetes-types/apps/v1';
import React from 'react';

// material-ui

// types

// project-imports
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import { PodContainersSectionFromPodSpec } from '../../../../sidebar/Pod/PodContainersSection';

interface Props {
  ctx: DrawerContext<Deployment>;
}

/**
 * Renders a sidebar for a Deployment resource
 */
export const DeploymentSidebar: React.FC<Props> = ({ ctx }) => {
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

DeploymentSidebar.displayName = 'DeploymentSidebar';
export default DeploymentSidebar;
