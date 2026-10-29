import { Stack } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import { CronJob } from 'kubernetes-types/batch/v1';
import React from 'react';

// types

// project-imports
import ObjectMetaSection from '../../../shared/ObjectMetaSection';

interface Props {
  ctx: DrawerContext<CronJob>;
}

/**
 * Renders a sidebar for a CronJob resource
 */
export const CronJobSidebar: React.FC<Props> = ({ ctx }) => {
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

CronJobSidebar.displayName = 'CronJobSidebar';
export default CronJobSidebar;
