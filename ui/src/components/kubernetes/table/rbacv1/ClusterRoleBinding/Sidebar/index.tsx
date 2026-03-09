import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { ClusterRoleBinding } from 'kubernetes-types/rbac/v1';
import React from 'react';

import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';
import SidebarSection from '../../../../../shared/SidebarSection';

interface Props {
  ctx: DrawerContext<ClusterRoleBinding>;
}

export const ClusterRoleBindingSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const crb = ctx.data;
  const connectionID = ctx.resource?.connectionID || '';
  const roleRef = crb.roleRef;
  const subjects = crb.subjects;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={crb.metadata} />

        {roleRef && (
          <SidebarSection title="Role Reference">
              <LabeledEntry
                label={roleRef.kind || 'ClusterRole'}
                value={
                  <ResourceLinkChip
                    connectionID={connectionID}
                    resourceID={roleRef.name || ''}
                    resourceKey="rbac::v1::ClusterRole"
                    resourceName={roleRef.name}
                  />
                }
              />
          </SidebarSection>
        )}

        {subjects && subjects.length > 0 && (
          <SidebarSection title="Subjects">
              {subjects.map((subj, i) => (
                <LabeledEntry
                  key={`${subj.kind}-${subj.name}-${i}`}
                  label={subj.kind || 'Subject'}
                  value={
                    subj.kind === 'ServiceAccount' ? (
                      <ResourceLinkChip
                        connectionID={connectionID}
                        namespace={subj.namespace}
                        resourceID={subj.name || ''}
                        resourceKey="core::v1::ServiceAccount"
                        resourceName={subj.name}
                      />
                    ) : (
                      `${subj.name}${subj.namespace ? ` (${subj.namespace})` : ''}`
                    )
                  }
                />
              ))}
          </SidebarSection>
        )}
      </Stack>
    </Stack>
  );
};

ClusterRoleBindingSidebar.displayName = 'ClusterRoleBindingSidebar';
export default ClusterRoleBindingSidebar;
