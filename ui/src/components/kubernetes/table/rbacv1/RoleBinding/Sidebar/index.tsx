import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { RoleBinding } from 'kubernetes-types/rbac/v1';
import React from 'react';

import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';
import SidebarSection from '../../../../../shared/SidebarSection';

interface Props {
  ctx: DrawerContext<RoleBinding>;
}

export const RoleBindingSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const rb = ctx.data;
  const connectionID = ctx.resource?.connectionID || '';
  const namespace = rb.metadata?.namespace;
  const roleRef = rb.roleRef;
  const subjects = rb.subjects;

  const roleKey = roleRef?.kind === 'ClusterRole'
    ? 'rbac::v1::ClusterRole'
    : 'rbac::v1::Role';

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={rb.metadata} />

        {roleRef && (
          <SidebarSection title="Role Reference">
              <LabeledEntry
                label={roleRef.kind || 'Role'}
                value={
                  <ResourceLinkChip
                    connectionID={connectionID}
                    namespace={roleRef.kind === 'Role' ? namespace : undefined}
                    resourceID={roleRef.name || ''}
                    resourceKey={roleKey}
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

RoleBindingSidebar.displayName = 'RoleBindingSidebar';
export default RoleBindingSidebar;
