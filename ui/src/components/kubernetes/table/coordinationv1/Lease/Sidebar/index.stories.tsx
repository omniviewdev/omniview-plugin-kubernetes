import type { Meta, StoryObj } from '@storybook/react-vite';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { LeaseSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/coordinationv1/LeaseSidebar',
  component: LeaseSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof LeaseSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="coordination::v1::Lease"
        icon="LuTimer"
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
      resource: { connectionID: 'ctx-1', id: 'kube-scheduler', key: 'coordination::v1::Lease', pluginID: 'kubernetes' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};
