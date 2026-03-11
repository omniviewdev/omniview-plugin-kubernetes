import type { Meta, StoryObj } from '@storybook/react-vite';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { CSIStorageCapacitySidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/storagev1/CSIStorageCapacitySidebar',
  component: CSIStorageCapacitySidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof CSIStorageCapacitySidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="storage::v1::CSIStorageCapacity"
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

export const Default: Story = {
  args: {
    ctx: {
      data: data as Record<string, unknown>,
      resource: { connectionID: 'ctx-1', id: 'csisc-a1b2c3d4', key: 'storage::v1::CSIStorageCapacity', pluginID: 'kubernetes' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};
