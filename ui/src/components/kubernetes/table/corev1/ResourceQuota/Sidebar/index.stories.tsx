import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ResourceQuota } from 'kubernetes-types/core/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { ResourceQuotaSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/corev1/ResourceQuotaSidebar',
  component: ResourceQuotaSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof ResourceQuotaSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="core::v1::ResourceQuota"
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

// -- Primary ----------------------------------------------------------------

export const Primary: Story = {
  args: {
    ctx: {
      data: data as unknown as ResourceQuota,
      resource: { connectionID: 'ctx-1', id: 'compute-quota', key: 'core::v1::ResourceQuota' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- FullUsage --------------------------------------------------------------

const fullUsageData: ResourceQuota = {
  ...(data as unknown as ResourceQuota),
  metadata: { ...data.metadata, name: 'full-quota' },
  status: {
    hard: { cpu: '8', memory: '16Gi', pods: '50', services: '10' },
    used: { cpu: '8', memory: '16Gi', pods: '50', services: '10' },
  },
};

export const FullUsage: Story = {
  args: {
    ctx: {
      data: fullUsageData,
      resource: { connectionID: 'ctx-1', id: 'full-quota', key: 'core::v1::ResourceQuota' },
    },
  },
  decorators: withDrawer('full-quota'),
};
