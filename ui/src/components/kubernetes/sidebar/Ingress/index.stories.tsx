import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Ingress } from 'kubernetes-types/networking/v1';

import ResourceDrawerContainer from '../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { IngressSidebar } from '.';

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: 'Kubernetes/Sidebars/Ingress',
  component: IngressSidebar,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ['autodocs'],
} satisfies Meta<typeof IngressSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {
    ctx: { data: data as unknown as Ingress },
  },
};

Primary.decorators = [
  (Story, c) => (
    <ResourceDrawerContainer
      icon="LuNetworking"
      type="networking::v1::Ingress"
      // @ts-expect-error - arbitrary json
      title={c.args.ctx.data.metadata.name}
      open
      onClose={() => {}}
    >
      <Story />
    </ResourceDrawerContainer>
  ),
];
