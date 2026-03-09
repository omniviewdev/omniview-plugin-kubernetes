import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CSIDriver } from 'kubernetes-types/storage/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { CSIDriverSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/storagev1/CSIDriverSidebar',
  component: CSIDriverSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof CSIDriverSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="storage::v1::CSIDriver"
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
      data: data as unknown as CSIDriver,
      resource: { connectionID: 'ctx-1', id: 'ebs.csi.aws.com', key: 'storage::v1::CSIDriver' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};
