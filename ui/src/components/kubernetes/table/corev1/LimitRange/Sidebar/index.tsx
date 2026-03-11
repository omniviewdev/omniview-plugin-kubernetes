import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { LimitRange } from 'kubernetes-types/core/v1';
import React from 'react';

import LimitRangeItemSection from '../../../../../shared/LimitRangeItemSection';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';

interface Props {
  ctx: DrawerContext<LimitRange>;
}

export const LimitRangeSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const lr = ctx.data;
  const limits = lr.spec?.limits as Array<{
    type?: string;
    default?: Record<string, string>;
    defaultRequest?: Record<string, string>;
    max?: Record<string, string>;
    min?: Record<string, string>;
    maxLimitRequestRatio?: Record<string, string>;
  }> | undefined;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <ObjectMetaSection data={lr.metadata} />
      <LimitRangeItemSection limits={limits} />
    </Stack>
  );
};

LimitRangeSidebar.displayName = 'LimitRangeSidebar';
export default LimitRangeSidebar;
