import { Chip, Stack } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import type { ResourceQuota } from 'kubernetes-types/core/v1';
import React from 'react';

import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import QuotaUsageTable from '../../../../../shared/QuotaUsageTable';

const fullWidthStyle = { width: '100%' } as const;

const chipStyle = { borderRadius: 4 } as const;

interface Props {
  ctx: DrawerContext<ResourceQuota>;
}

export const ResourceQuotaSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const rq = ctx.data;
  const hard = rq.status?.hard;
  const used = rq.status?.used;
  const scopes = rq.spec?.scopes;

  return (
    <Stack direction="column" spacing={4} style={fullWidthStyle}>
      <ObjectMetaSection data={rq.metadata} connectionID={ctx.resource?.connectionID} />

      <QuotaUsageTable hard={hard} used={used} />

      {scopes && scopes.length > 0 && (
        <Stack direction="row" spacing={1} wrap>
          {scopes.map((scope) => (
            <Chip key={scope} size="xs" color="brand" style={chipStyle}>{scope}</Chip>
          ))}
        </Stack>
      )}
    </Stack>
  );
};

ResourceQuotaSidebar.displayName = 'ResourceQuotaSidebar';
export default ResourceQuotaSidebar;
