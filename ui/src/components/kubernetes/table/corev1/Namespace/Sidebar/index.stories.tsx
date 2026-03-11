import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Namespace } from 'kubernetes-types/core/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { NamespaceSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/corev1/NamespaceSidebar',
  component: NamespaceSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof NamespaceSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shared decorator factory — all Namespace stories use the same container shell. */
function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="core::v1::Namespace"
        icon="LuFolderOpen"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

// -- Active (default mock) --------------------------------------------------

export const Active: Story = {
  args: {
    ctx: {
      data: data as unknown as Namespace,
      resource: { connectionID: 'ctx-1', id: 'production', key: 'core::v1::Namespace' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- Terminating ------------------------------------------------------------

const terminatingData: Namespace = {
  ...(data as unknown as Namespace),
  status: {
    ...(data as unknown as Namespace).status,
    phase: 'Terminating',
  },
};

export const Terminating: Story = {
  args: {
    ctx: {
      data: terminatingData,
      resource: { connectionID: 'ctx-1', id: 'production', key: 'core::v1::Namespace' },
    },
  },
  decorators: withDrawer('production'),
};
