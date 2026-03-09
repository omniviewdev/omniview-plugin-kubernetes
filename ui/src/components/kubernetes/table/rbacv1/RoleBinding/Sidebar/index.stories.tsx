import type { Meta, StoryObj } from '@storybook/react-vite';
import type { RoleBinding } from 'kubernetes-types/rbac/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { RoleBindingSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/rbacv1/RoleBindingSidebar',
  component: RoleBindingSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof RoleBindingSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="rbac::v1::RoleBinding"
        icon="LuLink"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

export const Default: Story = {
  args: {
    ctx: {
      data: data as unknown as RoleBinding,
      resource: { connectionID: 'ctx-1', id: 'dev-pod-manager', key: 'rbac::v1::RoleBinding' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};
