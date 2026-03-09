import type { Meta, StoryObj } from '@storybook/react-vite';
import type { FlowSchema } from 'kubernetes-types/flowcontrol/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { FlowSchemaSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/flowcontrolv1/FlowSchemaSidebar',
  component: FlowSchemaSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof FlowSchemaSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="flowcontrol::v1::FlowSchema"
        icon="LuGitBranch"
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
      data: data as unknown as FlowSchema,
      resource: { connectionID: 'ctx-1', id: 'system-leader-election', key: 'flowcontrol::v1::FlowSchema' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};
