import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { MutatingWebhookConfiguration } from 'kubernetes-types/admissionregistration/v1';
import React from 'react';

import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import WebhookSection from '../../../../../shared/WebhookSection';

interface Props {
  ctx: DrawerContext<MutatingWebhookConfiguration>;
}

export const MutatingWebhookConfigurationSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const mwc = ctx.data;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <ObjectMetaSection data={mwc.metadata} />
      <WebhookSection webhooks={mwc.webhooks} />
    </Stack>
  );
};

MutatingWebhookConfigurationSidebar.displayName = 'MutatingWebhookConfigurationSidebar';
export default MutatingWebhookConfigurationSidebar;
