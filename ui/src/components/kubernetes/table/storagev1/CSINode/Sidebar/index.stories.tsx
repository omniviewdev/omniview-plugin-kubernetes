import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CSINode } from 'kubernetes-types/storage/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { CSINodeSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/storagev1/CSINodeSidebar',
  component: CSINodeSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof CSINodeSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="storage::v1::CSINode"
        icon="LuServer"
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
      data: data as unknown as CSINode,
      resource: { connectionID: 'ctx-1', id: 'ip-10-0-1-42.ec2.internal', key: 'storage::v1::CSINode' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};
