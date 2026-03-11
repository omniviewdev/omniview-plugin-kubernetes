import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import type { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';

import ConditionChip from './ConditionChip';
import LabeledEntry from './LabeledEntry';
import SidebarSection from './SidebarSection';

interface Props {
  title: string;
  counts: Array<{ label: string; value?: number }>;
  conditions?: Condition[];
  paused?: boolean;
}

const WorkloadStatusSection: React.FC<Props> = ({ title, counts, conditions, paused }) => {
  return (
    <SidebarSection
      title={title}
      headerLeft={paused ? <Chip size="xs" emphasis="soft" color="warning" label="Paused" /> : undefined}
      headerRight={conditions && conditions.length > 0 ? (
        <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="flex-end">
          {conditions.map((c) => (
            <ConditionChip key={c.type} condition={c} />
          ))}
        </Stack>
      ) : undefined}
    >
      {counts.map((c) => (
        <LabeledEntry
          key={c.label}
          label={c.label}
          value={c.value !== undefined ? String(c.value) : undefined}
        />
      ))}
    </SidebarSection>
  );
};

export default WorkloadStatusSection;
