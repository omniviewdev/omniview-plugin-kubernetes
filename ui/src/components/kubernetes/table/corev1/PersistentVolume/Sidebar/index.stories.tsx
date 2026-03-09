import type { Meta, StoryObj } from '@storybook/react-vite';
import type { PersistentVolume } from 'kubernetes-types/core/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { PersistentVolumeSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/corev1/PersistentVolumeSidebar',
  component: PersistentVolumeSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof PersistentVolumeSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="core::v1::PersistentVolume"
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
      data: data as unknown as PersistentVolume,
      resource: { connectionID: 'ctx-1', id: 'pv-nfs-data', key: 'core::v1::PersistentVolume' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- Available --------------------------------------------------------------

const availableData: PersistentVolume = {
  ...(data as unknown as PersistentVolume),
  metadata: { ...data.metadata, name: 'pv-available' },
  spec: {
    ...(data as unknown as PersistentVolume).spec,
    claimRef: undefined,
  },
  status: { phase: 'Available' },
};

export const Available: Story = {
  args: {
    ctx: {
      data: availableData,
      resource: { connectionID: 'ctx-1', id: 'pv-available', key: 'core::v1::PersistentVolume' },
    },
  },
  decorators: withDrawer('pv-available'),
};

// -- Released ---------------------------------------------------------------

const releasedData: PersistentVolume = {
  ...(data as unknown as PersistentVolume),
  metadata: { ...data.metadata, name: 'pv-released' },
  status: { phase: 'Released' },
};

export const Released: Story = {
  args: {
    ctx: {
      data: releasedData,
      resource: { connectionID: 'ctx-1', id: 'pv-released', key: 'core::v1::PersistentVolume' },
    },
  },
  decorators: withDrawer('pv-released'),
};
