import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ClusterRole } from 'kubernetes-types/rbac/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { ClusterRoleSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/rbacv1/ClusterRoleSidebar',
  component: ClusterRoleSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof ClusterRoleSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="rbac::v1::ClusterRole"
        icon="LuShieldCheck"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

// -- WithRules (default mock) ---------------------------------------------

export const WithRules: Story = {
  args: {
    ctx: {
      data: data as unknown as ClusterRole,
      resource: { connectionID: 'ctx-1', id: 'monitoring-reader', key: 'rbac::v1::ClusterRole' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- WithAggregation ------------------------------------------------------

const aggregatedData: ClusterRole = {
  ...(data as unknown as ClusterRole),
  metadata: { ...data.metadata, name: 'aggregate-monitoring' },
  rules: [],
  aggregationRule: {
    clusterRoleSelectors: [
      {
        matchLabels: {
          'rbac.authorization.k8s.io/aggregate-to-monitoring': 'true',
        },
      },
      {
        matchLabels: {
          'rbac.authorization.k8s.io/aggregate-to-view': 'true',
        },
      },
    ],
  },
};

export const WithAggregation: Story = {
  args: {
    ctx: {
      data: aggregatedData,
      resource: { connectionID: 'ctx-1', id: 'aggregate-monitoring', key: 'rbac::v1::ClusterRole' },
    },
  },
  decorators: withDrawer('aggregate-monitoring'),
};
