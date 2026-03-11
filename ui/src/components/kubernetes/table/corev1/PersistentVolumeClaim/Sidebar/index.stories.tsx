import type { Meta, StoryObj } from '@storybook/react-vite';
import type { PersistentVolumeClaim } from 'kubernetes-types/core/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { PersistentVolumeClaimSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/corev1/PersistentVolumeClaimSidebar',
  component: PersistentVolumeClaimSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof PersistentVolumeClaimSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="core::v1::PersistentVolumeClaim"
        icon="LuHardDrive"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

// -- Bound (default) --------------------------------------------------------

export const Bound: Story = {
  args: {
    ctx: {
      data: data as unknown as PersistentVolumeClaim,
      resource: { connectionID: 'ctx-1', id: 'data-pvc', key: 'core::v1::PersistentVolumeClaim' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- Pending ----------------------------------------------------------------

const pendingData: PersistentVolumeClaim = {
  ...(data as unknown as PersistentVolumeClaim),
  metadata: { ...data.metadata, name: 'pending-pvc' },
  spec: {
    ...(data as unknown as PersistentVolumeClaim).spec,
    volumeName: undefined,
  },
  status: {
    phase: 'Pending',
  },
};

export const Pending: Story = {
  args: {
    ctx: {
      data: pendingData,
      resource: { connectionID: 'ctx-1', id: 'pending-pvc', key: 'core::v1::PersistentVolumeClaim' },
    },
  },
  decorators: withDrawer('pending-pvc'),
};
