import type { Meta, StoryObj } from '@storybook/react-vite';
import type { HorizontalPodAutoscaler } from 'kubernetes-types/autoscaling/v2';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { HorizontalPodAutoscalerSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/autoscalingv1/HorizontalPodAutoscalerSidebar',
  component: HorizontalPodAutoscalerSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof HorizontalPodAutoscalerSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shared decorator factory — all HPA stories use the same container shell. */
function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="autoscaling::v2::HorizontalPodAutoscaler"
        icon="LuArrowUpDown"
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
      data: data as unknown as HorizontalPodAutoscaler,
      resource: { connectionID: 'ctx-1', id: 'frontend-hpa', key: 'autoscaling::v2::HorizontalPodAutoscaler' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};
