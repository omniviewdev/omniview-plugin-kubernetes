import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { Role } from 'kubernetes-types/rbac/v1';
import React from 'react';

import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import RBACRulesSection from '../../../../../shared/RBACRulesSection';

interface Props {
  ctx: DrawerContext<Role>;
}

export const RoleSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const role = ctx.data;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <ObjectMetaSection data={role.metadata} />
      <RBACRulesSection rules={role.rules} />
    </Stack>
  );
};

RoleSidebar.displayName = 'RoleSidebar';
export default RoleSidebar;
