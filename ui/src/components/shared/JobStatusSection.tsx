import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import type { Condition } from 'kubernetes-types/meta/v1';
import { formatRelative } from 'date-fns';
import React from 'react';

import ConditionChip from './ConditionChip';
import LabeledEntry from './LabeledEntry';
import SidebarSection from './SidebarSection';

interface JobStatusLike {
  startTime?: string;
  completionTime?: string;
  succeeded?: number;
  failed?: number;
  active?: number;
}

interface Props {
  status?: JobStatusLike;
  conditions?: Condition[];
}

function getPhase(status?: JobStatusLike): {
  label: string;
  color: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
} {
  if (!status) return { label: 'Unknown', color: 'neutral' };
  if (status.succeeded && status.succeeded > 0 && !status.active)
    return { label: 'Complete', color: 'success' };
  if (status.failed && status.failed > 0 && !status.active)
    return { label: 'Failed', color: 'danger' };
  if (status.active && status.active > 0)
    return { label: 'Running', color: 'info' };
  return { label: 'Pending', color: 'warning' };
}

const JobStatusSection: React.FC<Props> = ({ status, conditions }) => {
  const phase = getPhase(status);
  const now = new Date();

  return (
    <SidebarSection
      title="Status"
      headerLeft={<Chip size="xs" emphasis="soft" color={phase.color} label={phase.label} />}
      headerRight={conditions && conditions.length > 0 ? (
        <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="flex-end">
          {conditions.map((c) => (
            <ConditionChip key={c.type} condition={c} />
          ))}
        </Stack>
      ) : undefined}
    >
      {status?.startTime && (
        <LabeledEntry
          label="Started"
          value={formatRelative(new Date(status.startTime), now)}
        />
      )}
      {status?.completionTime && (
        <LabeledEntry
          label="Completed"
          value={formatRelative(new Date(status.completionTime), now)}
        />
      )}
      <LabeledEntry
        label="Succeeded"
        value={status?.succeeded !== undefined ? String(status.succeeded) : undefined}
      />
      <LabeledEntry
        label="Failed"
        value={status?.failed !== undefined ? String(status.failed) : undefined}
      />
      <LabeledEntry
        label="Active"
        value={status?.active !== undefined ? String(status.active) : undefined}
      />
    </SidebarSection>
  );
};

export default JobStatusSection;
