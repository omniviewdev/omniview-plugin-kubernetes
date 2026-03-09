import type { Meta, StoryObj } from '@storybook/react-vite';
import type { StatefulSet } from 'kubernetes-types/apps/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { StatefulSetSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/appsv1/StatefulSetSidebar',
  component: StatefulSetSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof StatefulSetSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shared decorator factory — all StatefulSet stories use the same container shell. */
function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="apps::v1::StatefulSet"
        icon="LuDatabase"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

// -- OrderedReady (default mock) --------------------------------------------

export const OrderedReady: Story = {
  args: {
    ctx: {
      data: data as unknown as StatefulSet,
      resource: { connectionID: 'ctx-1', id: 'postgres', key: 'apps::v1::StatefulSet' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- Parallel ---------------------------------------------------------------

const parallelData: StatefulSet = {
  ...(data as unknown as StatefulSet),
  metadata: { ...data.metadata, name: 'redis-cluster' },
  spec: {
    ...(data as unknown as StatefulSet).spec!,
    serviceName: 'redis-headless',
    podManagementPolicy: 'Parallel',
    replicas: 6,
    selector: { matchLabels: { app: 'redis' } },
    volumeClaimTemplates: [
      {
        metadata: { name: 'data' },
        spec: {
          accessModes: ['ReadWriteOnce'],
          storageClassName: 'gp3',
          resources: { requests: { storage: '20Gi' } },
        },
      },
    ],
  },
  status: {
    replicas: 6,
    readyReplicas: 6,
    availableReplicas: 6,
    currentReplicas: 6,
    updatedReplicas: 6,
    currentRevision: 'redis-cluster-5b9f8a6c2',
    updateRevision: 'redis-cluster-5b9f8a6c2',
    observedGeneration: 1,
    collisionCount: 0,
  },
};

export const Parallel: Story = {
  args: {
    ctx: {
      data: parallelData,
      resource: { connectionID: 'ctx-1', id: 'redis-cluster', key: 'apps::v1::StatefulSet' },
    },
  },
  decorators: withDrawer('redis-cluster'),
};
