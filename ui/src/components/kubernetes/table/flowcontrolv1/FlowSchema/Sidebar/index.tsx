import { Chip } from '@omniviewdev/ui';
import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { FlowSchema } from 'kubernetes-types/flowcontrol/v1';
import type { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';

import ConditionChip from '../../../../../shared/ConditionChip';
import ExpandableSections, { type ExpandableSection } from '../../../../../shared/ExpandableSections';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';
import SidebarSection from '../../../../../shared/SidebarSection';

const chipSx = { borderRadius: 1 } as const;

interface Props {
  ctx: DrawerContext<FlowSchema>;
}

export const FlowSchemaSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const fs = ctx.data;
  const connectionID = ctx.resource?.connectionID || '';
  const spec = fs.spec;
  const conditions = (fs.status?.conditions || []) as Condition[];
  const plcRef = spec?.priorityLevelConfiguration;
  const rules = spec?.rules;

  const ruleSections: ExpandableSection[] = (rules || []).map((rule, i) => ({
    title: `Rule ${i + 1}`,
    defaultExpanded: i === 0,
    children: (
      <Stack direction="column" gap={0.5} sx={{ px: 1, py: 0.5 }}>
        {rule.subjects && rule.subjects.length > 0 && (
          <Stack direction="column" gap={0.25}>
            <Text size="xs" sx={{ color: 'neutral.400' }}>Subjects</Text>
            <Stack direction="row" gap={0.5} flexWrap="wrap">
              {rule.subjects.map((subj, si) => (
                <Chip
                  key={si}
                  size="xs"
                  emphasis="soft"
                  color="neutral"
                  label={subj.kind === 'User' ? `User: ${subj.user?.name}` :
                         subj.kind === 'Group' ? `Group: ${subj.group?.name}` :
                         subj.kind === 'ServiceAccount' ? `SA: ${subj.serviceAccount?.namespace}/${subj.serviceAccount?.name}` :
                         subj.kind}
                  sx={chipSx}
                />
              ))}
            </Stack>
          </Stack>
        )}
        {rule.resourceRules && rule.resourceRules.length > 0 && (
          <Stack direction="column" gap={0.25}>
            <Text size="xs" sx={{ color: 'neutral.400' }}>Resource Rules</Text>
            {rule.resourceRules.map((rr, ri) => (
              <Stack key={ri} direction="row" gap={0.5} flexWrap="wrap">
                {rr.verbs?.map((v) => <Chip key={v} size="xs" emphasis="soft" color="neutral" label={v} sx={chipSx} />)}
                {rr.apiGroups?.map((g, gi) => <Chip key={`g-${gi}`} size="xs" emphasis="outline" color="primary" label={g || '*'} sx={chipSx} />)}
                {rr.resources?.map((r) => <Chip key={r} size="xs" emphasis="outline" color="info" label={r} sx={chipSx} />)}
              </Stack>
            ))}
          </Stack>
        )}
        {rule.nonResourceRules && rule.nonResourceRules.length > 0 && (
          <Stack direction="column" gap={0.25}>
            <Text size="xs" sx={{ color: 'neutral.400' }}>Non-Resource Rules</Text>
            {rule.nonResourceRules.map((nr, ni) => (
              <Stack key={ni} direction="row" gap={0.5} flexWrap="wrap">
                {nr.verbs?.map((v) => <Chip key={v} size="xs" emphasis="soft" color="neutral" label={v} sx={chipSx} />)}
                {nr.nonResourceURLs?.map((u) => <Chip key={u} size="xs" emphasis="outline" color="primary" label={u} sx={chipSx} />)}
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    ),
  }));

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={fs.metadata} />

        <SidebarSection
          title="Configuration"
          headerRight={conditions.length > 0 ? (
            <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="flex-end">
              {conditions.map((c) => <ConditionChip key={c.type} condition={c} />)}
            </Stack>
          ) : undefined}
        >
            {plcRef?.name && (
              <LabeledEntry
                label="Priority Level"
                value={
                  <ResourceLinkChip
                    connectionID={connectionID}
                    resourceID={plcRef.name}
                    resourceKey="flowcontrol::v1::PriorityLevelConfiguration"
                    resourceName={plcRef.name}
                  />
                }
              />
            )}
            <LabeledEntry label="Matching Precedence" value={spec?.matchingPrecedence !== undefined ? String(spec.matchingPrecedence) : undefined} />
            <LabeledEntry label="Distinguisher Method" value={spec?.distinguisherMethod?.type} />
        </SidebarSection>
      </Stack>

      {ruleSections.length > 0 && <ExpandableSections sections={ruleSections} />}
    </Stack>
  );
};

FlowSchemaSidebar.displayName = 'FlowSchemaSidebar';
export default FlowSchemaSidebar;
