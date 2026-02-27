import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { Endpoints } from 'kubernetes-types/core/v1';
import React from 'react';

// material-ui

// types

// project-imports
import ObjectMetaSection from '../../../shared/ObjectMetaSection';

interface Props {
  ctx: DrawerContext<Endpoints>;
}

/**
 * Renders a sidebar for an Endpoint resource
 */
export const EndpointSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const obj = ctx.data;

  // compose your component here
  return (
    <Stack direction="column" width={'100%'} spacing={2}>
      <ObjectMetaSection data={obj.metadata} />
    </Stack>
  );
};

EndpointSidebar.displayName = 'EndpointSidebar';
export default EndpointSidebar;
