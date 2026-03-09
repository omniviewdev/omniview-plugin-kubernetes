import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { ServiceAccount } from 'kubernetes-types/core/v1';
import React from 'react';

import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';
import SidebarSection from '../../../../../shared/SidebarSection';

interface Props {
  ctx: DrawerContext<ServiceAccount>;
}

export const ServiceAccountSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const sa = ctx.data;
  const connectionID = ctx.resource?.connectionID || '';
  const namespace = sa.metadata?.namespace;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={sa.metadata} />

        <SidebarSection title="Configuration">
          <LabeledEntry
            label="Automount Token"
            value={sa.automountServiceAccountToken === false ? 'No' : 'Yes'}
          />
        </SidebarSection>

        {sa.secrets && sa.secrets.length > 0 && (
          <SidebarSection title="Secrets">
            <Stack direction="row" gap={0.5} flexWrap="wrap">
              {sa.secrets.map((ref) => (
                <ResourceLinkChip
                  key={ref.name}
                  connectionID={connectionID}
                  namespace={namespace}
                  resourceID={ref.name || ''}
                  resourceKey="core::v1::Secret"
                  resourceName={ref.name}
                />
              ))}
            </Stack>
          </SidebarSection>
        )}

        {sa.imagePullSecrets && sa.imagePullSecrets.length > 0 && (
          <SidebarSection title="Image Pull Secrets">
            <Stack direction="row" gap={0.5} flexWrap="wrap">
              {sa.imagePullSecrets.map((ref) => (
                <ResourceLinkChip
                  key={ref.name}
                  connectionID={connectionID}
                  namespace={namespace}
                  resourceID={ref.name || ''}
                  resourceKey="core::v1::Secret"
                  resourceName={ref.name}
                />
              ))}
            </Stack>
          </SidebarSection>
        )}
      </Stack>
    </Stack>
  );
};

ServiceAccountSidebar.displayName = 'ServiceAccountSidebar';
export default ServiceAccountSidebar;
