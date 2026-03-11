import type { Meta, StoryObj } from '@storybook/react-vite';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { PriorityClassSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/schedulingv1/PriorityClassSidebar',
  component: PriorityClassSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof PriorityClassSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="scheduling::v1::PriorityClass"
        icon="LuArrowUp"
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
      resource: { connectionID: 'ctx-1', id: 'high-priority', key: 'scheduling::v1::PriorityClass', pluginID: 'kubernetes' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};
