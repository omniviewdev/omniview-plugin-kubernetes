import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { ComponentStatus } from 'kubernetes-types/core/v1';
import type { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';

import ConditionChip from '../../../../../shared/ConditionChip';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import SidebarSection from '../../../../../shared/SidebarSection';

interface Props {
  ctx: DrawerContext<ComponentStatus>;
}

export const ComponentStatusSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const cs = ctx.data;
  const conditions = cs.conditions || [];

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={cs.metadata} />

        {conditions.length > 0 && (
          <SidebarSection
            title="Conditions"
            headerRight={
              <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="flex-end">
                {conditions.map((c) => (
                  <ConditionChip key={c.type} condition={c as Condition} />
                ))}
              </Stack>
            }
          >
            {conditions.map((c) => (
              <React.Fragment key={c.type}>
                <LabeledEntry label="Type" value={c.type} />
                <LabeledEntry label="Status" value={c.status} />
                {c.message && <LabeledEntry label="Message" value={c.message} />}
                {c.error && <LabeledEntry label="Error" value={c.error} />}
              </React.Fragment>
            ))}
          </SidebarSection>
        )}
      </Stack>
    </Stack>
  );
};

ComponentStatusSidebar.displayName = 'ComponentStatusSidebar';
export default ComponentStatusSidebar;
