import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { ClusterRole } from 'kubernetes-types/rbac/v1';
import React from 'react';

import KVCard from '../../../../../shared/KVCard';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import RBACRulesSection from '../../../../../shared/RBACRulesSection';

interface Props {
  ctx: DrawerContext<ClusterRole>;
}

export const ClusterRoleSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const cr = ctx.data;
  const rules = cr.rules;
  const aggregationRule = cr.aggregationRule;
  const selectors = aggregationRule?.clusterRoleSelectors;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <ObjectMetaSection data={cr.metadata} />

      <RBACRulesSection rules={rules} />

      {selectors && selectors.length > 0 && (
        <Stack direction="column" gap={1}>
          {selectors.map((sel, i) =>
            sel.matchLabels && Object.keys(sel.matchLabels).length > 0 ? (
              <KVCard
                key={i}
                title={`Aggregation Selector ${i + 1}`}
                kvs={sel.matchLabels as Record<string, string>}
                defaultExpanded
              />
            ) : null,
          )}
        </Stack>
      )}
    </Stack>
  );
};

ClusterRoleSidebar.displayName = 'ClusterRoleSidebar';
export default ClusterRoleSidebar;
