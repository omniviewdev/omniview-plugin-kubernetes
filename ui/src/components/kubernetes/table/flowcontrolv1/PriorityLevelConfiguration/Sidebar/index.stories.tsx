import type { Meta, StoryObj } from '@storybook/react-vite';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { PriorityLevelConfigurationSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/flowcontrolv1/PriorityLevelConfigurationSidebar',
  component: PriorityLevelConfigurationSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof PriorityLevelConfigurationSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="flowcontrol::v1::PriorityLevelConfiguration"
        icon="LuLayers"
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
      resource: { connectionID: 'ctx-1', id: 'leader-election', key: 'flowcontrol::v1::PriorityLevelConfiguration', pluginID: 'kubernetes' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};
