import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReplicaSet } from 'kubernetes-types/apps/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { ReplicaSetSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/appsv1/ReplicaSetSidebar',
  component: ReplicaSetSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof ReplicaSetSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shared decorator factory — all ReplicaSet stories use the same container shell. */
function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="apps::v1::ReplicaSet"
        icon="LuCopy"
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
      data: data as unknown as ReplicaSet,
      resource: { connectionID: 'ctx-1', id: 'frontend-7c6b4f9d8', key: 'apps::v1::ReplicaSet' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- Scaling ----------------------------------------------------------------

const scalingData: ReplicaSet = {
  ...(data as unknown as ReplicaSet),
  metadata: { ...data.metadata, name: 'frontend-7c6b4f9d8' },
  spec: {
    ...(data as unknown as ReplicaSet).spec!,
    replicas: 5,
  },
  status: {
    replicas: 5,
    readyReplicas: 3,
    availableReplicas: 3,
    fullyLabeledReplicas: 5,
    observedGeneration: 2,
    conditions: [
      {
        type: 'ReplicaFailure',
        status: 'False',
        lastTransitionTime: '2025-06-15T10:00:00Z',
        reason: 'ScalingUp',
        message: 'Scaling from 3 to 5 replicas',
      },
    ],
  },
};

export const Scaling: Story = {
  args: {
    ctx: {
      data: scalingData,
      resource: { connectionID: 'ctx-1', id: 'frontend-7c6b4f9d8', key: 'apps::v1::ReplicaSet' },
    },
  },
  decorators: withDrawer('frontend-7c6b4f9d8'),
};
