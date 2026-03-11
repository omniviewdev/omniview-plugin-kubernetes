import type { Meta, StoryObj } from '@storybook/react-vite';
import type { VolumeAttachment } from 'kubernetes-types/storage/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { VolumeAttachmentSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/storagev1/VolumeAttachmentSidebar',
  component: VolumeAttachmentSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof VolumeAttachmentSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="storage::v1::VolumeAttachment"
        icon="LuLink"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

// -- Attached (default mock) ----------------------------------------------

export const Attached: Story = {
  args: {
    ctx: {
      data: data as unknown as VolumeAttachment,
      resource: { connectionID: 'ctx-1', id: 'csi-a1b2c3d4e5f6', key: 'storage::v1::VolumeAttachment' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- Detached -------------------------------------------------------------

const detachedData: VolumeAttachment = {
  ...(data as unknown as VolumeAttachment),
  metadata: { ...data.metadata, name: 'csi-detached-xyz' },
  status: {
    attached: false,
    detachError: {
      time: '2025-08-20T17:00:00Z',
      message: 'rpc error: code = Internal desc = Could not detach volume "vol-0a1b2c3d4e5f67890" from node "i-0a1b2c3d4e5f67890": VolumeInUse',
    },
  },
};

export const Detached: Story = {
  args: {
    ctx: {
      data: detachedData,
      resource: { connectionID: 'ctx-1', id: 'csi-detached-xyz', key: 'storage::v1::VolumeAttachment' },
    },
  },
  decorators: withDrawer('csi-detached-xyz'),
};
