import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { MutatingWebhookConfiguration } from 'kubernetes-types/admissionregistration/v1';
import React from 'react';

// material-ui

// types

// project-imports
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';

interface Props {
  ctx: DrawerContext<MutatingWebhookConfiguration>;
}

/**
 * Renders a sidebar for a MutatingWebhookConfiguration resource
 */
export const MutatingWebhookConfigurationSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  return (
    <Stack direction="column" width={'100%'} spacing={2}>
      <ObjectMetaSection data={ctx.data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

MutatingWebhookConfigurationSidebar.displayName = 'MutatingWebhookConfigurationSidebar';
export default MutatingWebhookConfigurationSidebar;
