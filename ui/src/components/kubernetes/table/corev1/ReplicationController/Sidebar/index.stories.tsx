import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReplicationController } from 'kubernetes-types/core/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { ReplicationControllerSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/corev1/ReplicationControllerSidebar',
  component: ReplicationControllerSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof ReplicationControllerSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="core::v1::ReplicationController"
        icon="LuCopy"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

// -- Primary ----------------------------------------------------------------

export const Primary: Story = {
  args: {
    ctx: {
      data: data as unknown as ReplicationController,
      resource: { connectionID: 'ctx-1', id: 'web-rc', key: 'core::v1::ReplicationController' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};
