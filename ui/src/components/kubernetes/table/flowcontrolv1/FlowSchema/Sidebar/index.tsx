import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { FlowSchema } from 'kubernetes-types/flowcontrol/v1';
import React from 'react';

// material-ui

// types

// project-imports
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';

interface Props {
  ctx: DrawerContext<FlowSchema>;
}

/**
 * Renders a sidebar for a FlowSchema resource
 */
export const FlowSchemaSidebar: React.FC<Props> = ({ ctx }) => {
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

FlowSchemaSidebar.displayName = 'FlowSchemaSidebar';
export default FlowSchemaSidebar;
