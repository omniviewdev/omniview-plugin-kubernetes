import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { ServiceAccount } from 'kubernetes-types/core/v1';
import React from 'react';

// material-ui

// types

// project-imports
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';

interface Props {
  ctx: DrawerContext<ServiceAccount>;
}

/**
 * Renders a sidebar for a ServiceAccount resource
 */
export const ServiceAccountSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  // compose your component here
  return (
    <Stack direction="column" width={'100%'} spacing={2}>
      <ObjectMetaSection data={ctx.data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

ServiceAccountSidebar.displayName = 'ServiceAccountSidebar';
export default ServiceAccountSidebar;
