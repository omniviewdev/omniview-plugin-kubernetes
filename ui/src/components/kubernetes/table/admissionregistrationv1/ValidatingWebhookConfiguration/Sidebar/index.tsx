import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { ValidatingWebhookConfiguration } from 'kubernetes-types/admissionregistration/v1';
import React from 'react';

// material-ui

// types

// project-imports
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';

interface Props {
  ctx: DrawerContext<ValidatingWebhookConfiguration>;
}

/**
 * Renders a sidebar for a ValidatingWebhookConfiguration resource
 */
export const ValidatingWebhookConfigurationSidebar: React.FC<Props> = ({ ctx }) => {
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

ValidatingWebhookConfigurationSidebar.displayName = 'ValidatingWebhookConfigurationSidebar';
export default ValidatingWebhookConfigurationSidebar;
