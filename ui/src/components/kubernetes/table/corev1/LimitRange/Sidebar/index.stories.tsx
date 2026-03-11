import type { Meta, StoryObj } from '@storybook/react-vite';
import type { LimitRange } from 'kubernetes-types/core/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { LimitRangeSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/corev1/LimitRangeSidebar',
  component: LimitRangeSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof LimitRangeSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shared decorator factory — all LimitRange stories use the same container shell. */
function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="core::v1::LimitRange"
        icon="LuGauge"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

// -- Primary (default mock) -------------------------------------------------

export const Primary: Story = {
  args: {
    ctx: {
      data: data as unknown as LimitRange,
      resource: { connectionID: 'ctx-1', id: 'default-limits', key: 'core::v1::LimitRange' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};
