import { DrawerContext } from '@omniviewdev/runtime';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { CronJob } from 'kubernetes-types/batch/v1';
import { formatRelative } from 'date-fns';
import React from 'react';

import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';
import SidebarSection from '../../../../../shared/SidebarSection';

interface Props {
  ctx: DrawerContext<CronJob>;
}

export const CronJobSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const cj = ctx.data;
  const spec = cj.spec;
  const status = cj.status;
  const connectionID = ctx.resource?.connectionID || '';
  const namespace = cj.metadata?.namespace;
  const now = new Date();

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={cj.metadata} />

        <SidebarSection
          title="Schedule"
          headerLeft={spec?.suspend && <Chip size="xs" emphasis="soft" color="warning" label="Suspended" />}
        >
          <LabeledEntry
            label="Schedule"
            value={
              <Text size="xs" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                {spec?.schedule}
              </Text>
            }
          />
          <LabeledEntry label="Time Zone" value={spec?.timeZone} />
          <LabeledEntry label="Concurrency Policy" value={spec?.concurrencyPolicy} />
          <LabeledEntry label="Success History" value={spec?.successfulJobsHistoryLimit !== undefined ? String(spec.successfulJobsHistoryLimit) : undefined} />
          <LabeledEntry label="Failed History" value={spec?.failedJobsHistoryLimit !== undefined ? String(spec.failedJobsHistoryLimit) : undefined} />
          <LabeledEntry label="Starting Deadline" value={spec?.startingDeadlineSeconds !== undefined ? `${spec.startingDeadlineSeconds}s` : undefined} />
        </SidebarSection>

        {(status?.lastScheduleTime || status?.lastSuccessfulTime) && (
          <SidebarSection title="Status">
            {status?.lastScheduleTime && (
              <LabeledEntry label="Last Scheduled" value={formatRelative(new Date(status.lastScheduleTime), now)} />
            )}
            {status?.lastSuccessfulTime && (
              <LabeledEntry label="Last Successful" value={formatRelative(new Date(status.lastSuccessfulTime), now)} />
            )}
          </SidebarSection>
        )}

        {status?.active && status.active.length > 0 && (
          <SidebarSection title="Active Jobs">
            <Stack direction="row" gap={0.5} flexWrap="wrap">
              {status.active.map((ref) => (
                <ResourceLinkChip
                  key={ref.name}
                  connectionID={connectionID}
                  namespace={ref.namespace || namespace}
                  resourceID={ref.name || ''}
                  resourceKey="batch::v1::Job"
                  resourceName={ref.name}
                />
              ))}
            </Stack>
          </SidebarSection>
        )}
      </Stack>
    </Stack>
  );
};

CronJobSidebar.displayName = 'CronJobSidebar';
export default CronJobSidebar;
