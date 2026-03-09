import { DrawerContext } from '@omniviewdev/runtime';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import type { Namespace } from 'kubernetes-types/core/v1';
import type { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';

import ConditionChip from '../../../../../shared/ConditionChip';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import SidebarSection from '../../../../../shared/SidebarSection';

interface Props {
  ctx: DrawerContext<Namespace>;
}

function phaseColor(phase?: string): 'success' | 'warning' | 'neutral' {
  switch (phase) {
    case 'Active':
      return 'success';
    case 'Terminating':
      return 'warning';
    default:
      return 'neutral';
  }
}

export const NamespaceSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const ns = ctx.data;
  const phase = ns.status?.phase;
  const conditions = (ns.status?.conditions || []) as Condition[];
  const finalizers = ns.spec?.finalizers;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={ns.metadata} />

        <SidebarSection
          title="Status"
          headerLeft={
            phase && (
              <Chip
                size="xs"
                emphasis="soft"
                color={phaseColor(phase)}
                label={phase}
              />
            )
          }
          headerRight={
            conditions.length > 0 ? (
              <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="flex-end">
                {conditions.map((c) => (
                  <ConditionChip key={c.type} condition={c} />
                ))}
              </Stack>
            ) : undefined
          }
        >
          <LabeledEntry label="Finalizers" value={finalizers && finalizers.length > 0 ? finalizers.join(', ') : undefined} />
        </SidebarSection>
      </Stack>
    </Stack>
  );
};

NamespaceSidebar.displayName = 'NamespaceSidebar';
export default NamespaceSidebar;
