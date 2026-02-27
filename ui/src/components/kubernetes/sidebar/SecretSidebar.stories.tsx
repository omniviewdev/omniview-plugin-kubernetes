import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Secret } from 'kubernetes-types/core/v1';

import ResourceDrawerContainer from '../../../stories/containers/SidebarContainer';

import data from './secret.mock.json';
import { SecretSidebar } from './SecretSidebar.tsx';

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: 'Kubernetes/Sidebars/SecretSidebar',
  component: SecretSidebar,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ['autodocs'],
} satisfies Meta<typeof SecretSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {
    ctx: { data: data as unknown as Secret },
  },
};

Primary.decorators = [
  (Story, c) => (
    <ResourceDrawerContainer
      type="core::v1::Secret"
      icon="LuFileKey"
      // @ts-expect-error - arbitrary json
      title={c.args.ctx.data.metadata.name}
      open
      onClose={() => {}}
    >
      <Story />
    </ResourceDrawerContainer>
  ),
];
