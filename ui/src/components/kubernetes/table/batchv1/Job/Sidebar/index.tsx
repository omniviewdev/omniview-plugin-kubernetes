import { DrawerContext } from '@omniviewdev/runtime';
import { Chip } from '@omniviewdev/ui';
import type { Job } from 'kubernetes-types/batch/v1';
import type { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';

import { Stack } from '@omniviewdev/ui/layout';
import JobStatusSection from '../../../../../shared/JobStatusSection';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import SidebarSection from '../../../../../shared/SidebarSection';
import WorkloadPortsCard from '../../../../../shared/WorkloadPortsCard';

interface Props {
  ctx: DrawerContext<Job>;
}

export const JobSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const job = ctx.data;
  const spec = job.spec;
  const status = job.status;
  const conditions = (status?.conditions || []) as Condition[];

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={job.metadata} />

        <JobStatusSection status={status} conditions={conditions} />

        <SidebarSection
          title="Configuration"
          headerLeft={spec?.suspend && <Chip size="xs" emphasis="soft" color="warning" label="Suspended" />}
        >
          <LabeledEntry label="Completions" value={spec?.completions !== undefined ? String(spec.completions) : undefined} />
          <LabeledEntry label="Parallelism" value={spec?.parallelism !== undefined ? String(spec.parallelism) : undefined} />
          <LabeledEntry label="Backoff Limit" value={spec?.backoffLimit !== undefined ? String(spec.backoffLimit) : undefined} />
          <LabeledEntry label="Active Deadline" value={spec?.activeDeadlineSeconds !== undefined ? `${spec.activeDeadlineSeconds}s` : undefined} />
          <LabeledEntry label="Completion Mode" value={spec?.completionMode} />
          <LabeledEntry label="TTL After Finished" value={spec?.ttlSecondsAfterFinished !== undefined ? `${spec.ttlSecondsAfterFinished}s` : undefined} />
        </SidebarSection>
      </Stack>

      {job.spec?.template?.spec && (
        <WorkloadPortsCard
          podSpec={job.spec.template.spec}
          resourceKey="batch::v1::Job"
          resourceData={job}
          resourceID={ctx.resource?.id || ''}
          connectionID={ctx.resource?.connectionID || ''}
        />
      )}
    </Stack>
  );
};

JobSidebar.displayName = 'JobSidebar';
export default JobSidebar;
