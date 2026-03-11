import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { ValidatingWebhookConfiguration } from 'kubernetes-types/admissionregistration/v1';
import React from 'react';

import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import WebhookSection from '../../../../../shared/WebhookSection';

interface Props {
  ctx: DrawerContext<ValidatingWebhookConfiguration>;
}

export const ValidatingWebhookConfigurationSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const vwc = ctx.data;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <ObjectMetaSection data={vwc.metadata} />
      <WebhookSection webhooks={vwc.webhooks} />
    </Stack>
  );
};

ValidatingWebhookConfigurationSidebar.displayName = 'ValidatingWebhookConfigurationSidebar';
export default ValidatingWebhookConfigurationSidebar;
