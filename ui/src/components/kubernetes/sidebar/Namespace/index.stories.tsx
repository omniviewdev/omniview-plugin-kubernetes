import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Namespace } from 'kubernetes-types/core/v1';

import ResourceDrawerContainer from '../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { NamespaceSidebar } from '.';

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: 'Kubernetes/Sidebars/Namespace',
  component: NamespaceSidebar,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ['autodocs'],
} satisfies Meta<typeof NamespaceSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {
    ctx: { data: data as unknown as Namespace },
  },
};

Primary.decorators = [
  (Story, c) => (
    <ResourceDrawerContainer
      icon="LuFileCog"
      type="core::v1::Namespace"
      // @ts-expect-error - arbitrary json
      title={c.args.ctx.data.metadata.name}
      open
      onClose={() => {}}
    >
      <Story />
    </ResourceDrawerContainer>
  ),
];
