import { Chip, Stack } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import type { VolumeAttachment } from 'kubernetes-types/storage/v1';
import React from 'react';

import KVCard from '../../../../../shared/KVCard';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';
import SidebarSection from '../../../../../shared/SidebarSection';

const fullWidthStyle = { width: '100%' } as const;

interface Props {
  ctx: DrawerContext<VolumeAttachment>;
}

export const VolumeAttachmentSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const va = ctx.data;
  const connectionID = ctx.resource?.connectionID || '';
  const spec = va.spec;
  const status = va.status;
  const attachmentMetadata = status?.attachmentMetadata;

  return (
    <Stack direction="column" spacing={4} style={fullWidthStyle}>
      <Stack direction="column" spacing={1}>
        <ObjectMetaSection data={va.metadata} connectionID={ctx.resource?.connectionID} />

        <SidebarSection
          title="Status"
          headerLeft={
            <Chip size="xs" color={status?.attached ? 'success' : 'warning'}>{status?.attached ? 'Attached' : 'Detached'}</Chip>
          }
        >
            {status?.attachError && (
              <LabeledEntry label="Attach Error" value={status.attachError.message} />
            )}
            {status?.detachError && (
              <LabeledEntry label="Detach Error" value={status.detachError.message} />
            )}
        </SidebarSection>

        <SidebarSection title="Configuration">
            <LabeledEntry label="Attacher" value={spec?.attacher} />
            {spec?.source?.persistentVolumeName && (
              <LabeledEntry
                label="Volume"
                value={
                  <ResourceLinkChip
                    connectionID={connectionID}
                    resourceID={spec.source.persistentVolumeName}
                    resourceKey="core::v1::PersistentVolume"
                    resourceName={spec.source.persistentVolumeName}
                  />
                }
              />
            )}
            {spec?.nodeName && (
              <LabeledEntry
                label="Node"
                value={
                  <ResourceLinkChip
                    connectionID={connectionID}
                    resourceID={spec.nodeName}
                    resourceKey="core::v1::Node"
                    resourceName={spec.nodeName}
                  />
                }
              />
            )}
        </SidebarSection>
      </Stack>

      {attachmentMetadata && Object.keys(attachmentMetadata).length > 0 && (
        <KVCard title="Attachment Metadata" kvs={attachmentMetadata} defaultExpanded />
      )}
    </Stack>
  );
};

VolumeAttachmentSidebar.displayName = 'VolumeAttachmentSidebar';
export default VolumeAttachmentSidebar;
