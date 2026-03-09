import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Deployment } from 'kubernetes-types/apps/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { DeploymentSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/appsv1/DeploymentSidebar',
  component: DeploymentSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof DeploymentSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shared decorator factory — all Deployment stories use the same container shell. */
function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="apps::v1::Deployment"
        icon="LuBox"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

// -- RollingUpdate (default mock) -------------------------------------------

export const RollingUpdate: Story = {
  args: {
    ctx: {
      data: data as unknown as Deployment,
      resource: { connectionID: 'ctx-1', id: 'frontend', key: 'apps::v1::Deployment' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- Recreate ---------------------------------------------------------------

const recreateData: Deployment = {
  ...(data as unknown as Deployment),
  metadata: { ...data.metadata, name: 'backend-worker' },
  spec: {
    ...(data as unknown as Deployment).spec!,
    strategy: { type: 'Recreate' },
  },
};

export const Recreate: Story = {
  args: {
    ctx: {
      data: recreateData,
      resource: { connectionID: 'ctx-1', id: 'backend-worker', key: 'apps::v1::Deployment' },
    },
  },
  decorators: withDrawer('backend-worker'),
};

// -- Paused -----------------------------------------------------------------

const pausedData: Deployment = {
  ...(data as unknown as Deployment),
  metadata: { ...data.metadata, name: 'frontend-canary' },
  spec: {
    ...(data as unknown as Deployment).spec!,
    paused: true,
  },
};

export const Paused: Story = {
  args: {
    ctx: {
      data: pausedData,
      resource: { connectionID: 'ctx-1', id: 'frontend-canary', key: 'apps::v1::Deployment' },
    },
  },
  decorators: withDrawer('frontend-canary'),
};
