import { Chip } from '@omniviewdev/ui';
import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { ValidatingAdmissionPolicyBinding } from 'kubernetes-types/admissionregistration/v1';
import React from 'react';

import LabeledEntry from '../../../../../shared/LabeledEntry';
import MatchResourcesSection from '../../../../../shared/MatchResourcesSection';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';
import SidebarSection from '../../../../../shared/SidebarSection';

const chipSx = { borderRadius: 1 } as const;

interface Props {
  ctx: DrawerContext<ValidatingAdmissionPolicyBinding>;
}

export const ValidatingAdmissionPolicyBindingSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const vapb = ctx.data;
  const connectionID = ctx.resource?.connectionID || '';
  const spec = vapb.spec;
  const validationActions = spec?.validationActions;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={vapb.metadata} />

        <SidebarSection title="Binding">
            {spec?.policyName && (
              <LabeledEntry
                label="Policy"
                value={
                  <ResourceLinkChip
                    connectionID={connectionID}
                    resourceID={spec.policyName}
                    resourceKey="admissionregistration::v1::ValidatingAdmissionPolicy"
                    resourceName={spec.policyName}
                  />
                }
              />
            )}
            {spec?.paramRef && (
              <>
                <LabeledEntry label="Param Name" value={spec.paramRef.name} />
                <LabeledEntry label="Param Namespace" value={spec.paramRef.namespace} />
                <LabeledEntry
                  label="Param Selector"
                  value={spec.paramRef.selector?.matchLabels
                    ? Object.entries(spec.paramRef.selector.matchLabels)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(', ')
                    : undefined}
                />
              </>
            )}
            {validationActions && validationActions.length > 0 && (
              <LabeledEntry
                label="Actions"
                value={
                  <Stack direction="row" gap={0.5} flexWrap="wrap">
                    {validationActions.map((action) => (
                      <Chip
                        key={action}
                        size="xs"
                        emphasis="soft"
                        color="primary"
                        label={action}
                        sx={chipSx}
                      />
                    ))}
                  </Stack>
                }
              />
            )}
        </SidebarSection>
      </Stack>

      <MatchResourcesSection matchResources={spec?.matchResources} />
    </Stack>
  );
};

ValidatingAdmissionPolicyBindingSidebar.displayName = 'ValidatingAdmissionPolicyBindingSidebar';
export default ValidatingAdmissionPolicyBindingSidebar;
