import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { PodDisruptionBudget } from 'kubernetes-types/policy/v1';
import React from 'react';

import ConditionChip from '../../../../../shared/ConditionChip';
import KVCard from '../../../../../shared/KVCard';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import SidebarSection from '../../../../../shared/SidebarSection';

interface Props {
  ctx: DrawerContext<PodDisruptionBudget>;
}

export const PodDisruptionBudgetSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const pdb = ctx.data;
  const spec = pdb.spec;
  const status = pdb.status;
  const conditions = status?.conditions || [];
  const selector = spec?.selector?.matchLabels as Record<string, string> | undefined;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={pdb.metadata} />

        <SidebarSection
          title="Status"
          headerRight={conditions.length > 0 ? (
            <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="flex-end">
              {conditions.map((c) => <ConditionChip key={c.type} condition={c} />)}
            </Stack>
          ) : undefined}
        >
            <LabeledEntry label="Current Healthy" value={status?.currentHealthy !== undefined ? String(status.currentHealthy) : undefined} />
            <LabeledEntry label="Desired Healthy" value={status?.desiredHealthy !== undefined ? String(status.desiredHealthy) : undefined} />
            <LabeledEntry label="Disruptions Allowed" value={status?.disruptionsAllowed !== undefined ? String(status.disruptionsAllowed) : undefined} />
            <LabeledEntry label="Expected Pods" value={status?.expectedPods !== undefined ? String(status.expectedPods) : undefined} />
        </SidebarSection>

        <SidebarSection title="Configuration">
            <LabeledEntry label="Min Available" value={spec?.minAvailable !== undefined ? String(spec.minAvailable) : undefined} />
            <LabeledEntry label="Max Unavailable" value={spec?.maxUnavailable !== undefined ? String(spec.maxUnavailable) : undefined} />
            <LabeledEntry label="Unhealthy Eviction" value={spec?.unhealthyPodEvictionPolicy} />
        </SidebarSection>
      </Stack>

      {selector && Object.keys(selector).length > 0 && (
        <KVCard title="Selector" kvs={selector} defaultExpanded />
      )}
    </Stack>
  );
};

PodDisruptionBudgetSidebar.displayName = 'PodDisruptionBudgetSidebar';
export default PodDisruptionBudgetSidebar;
