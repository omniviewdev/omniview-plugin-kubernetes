import { Chip } from '@omniviewdev/ui';
import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { ResourceQuota } from 'kubernetes-types/core/v1';
import React from 'react';

import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import QuotaUsageTable from '../../../../../shared/QuotaUsageTable';

const chipSx = { borderRadius: 1 } as const;

interface Props {
  ctx: DrawerContext<ResourceQuota>;
}

export const ResourceQuotaSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const rq = ctx.data;
  const hard = rq.status?.hard as Record<string, string> | undefined;
  const used = rq.status?.used as Record<string, string> | undefined;
  const scopes = rq.spec?.scopes;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <ObjectMetaSection data={rq.metadata} />

      <QuotaUsageTable hard={hard} used={used} />

      {scopes && scopes.length > 0 && (
        <Stack direction="row" gap={0.5} flexWrap="wrap">
          {scopes.map((scope) => (
            <Chip key={scope} size="xs" emphasis="soft" color="primary" label={scope} sx={chipSx} />
          ))}
        </Stack>
      )}
    </Stack>
  );
};

ResourceQuotaSidebar.displayName = 'ResourceQuotaSidebar';
export default ResourceQuotaSidebar;
