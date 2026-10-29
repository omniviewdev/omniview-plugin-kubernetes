import { Stack } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import { Endpoints } from 'kubernetes-types/core/v1';
import React from 'react';

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
    <Stack direction="column" spacing={4} style={{ width: '100%' }}>
      <ObjectMetaSection data={obj.metadata} connectionID={ctx.resource?.connectionID} />
    </Stack>
  );
};

EndpointSidebar.displayName = 'EndpointSidebar';
export default EndpointSidebar;
