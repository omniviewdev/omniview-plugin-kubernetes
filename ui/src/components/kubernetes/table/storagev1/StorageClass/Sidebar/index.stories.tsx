import type { Meta, StoryObj } from '@storybook/react-vite';
import type { StorageClass } from 'kubernetes-types/storage/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { StorageClassSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/storagev1/StorageClassSidebar',
  component: StorageClassSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof StorageClassSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="storage::v1::StorageClass"
        icon="LuDatabase"
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
      data: data as unknown as StorageClass,
      resource: { connectionID: 'ctx-1', id: 'gp3-encrypted', key: 'storage::v1::StorageClass' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};
