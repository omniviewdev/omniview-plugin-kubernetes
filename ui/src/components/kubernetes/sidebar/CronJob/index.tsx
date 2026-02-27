import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { CronJob } from 'kubernetes-types/batch/v1';
import React from 'react';

// material-ui

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
    <Stack direction="column" width={'100%'} spacing={2}>
      <ObjectMetaSection data={obj.metadata} />
    </Stack>
  );
};

CronJobSidebar.displayName = 'CronJobSidebar';
export default CronJobSidebar;
