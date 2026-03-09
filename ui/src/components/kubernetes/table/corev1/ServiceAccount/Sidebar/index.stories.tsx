import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ServiceAccount } from 'kubernetes-types/core/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { ServiceAccountSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/corev1/ServiceAccountSidebar',
  component: ServiceAccountSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof ServiceAccountSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="core::v1::ServiceAccount"
        icon="LuUser"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

// -- WithSecrets (default) --------------------------------------------------

export const WithSecrets: Story = {
  args: {
    ctx: {
      data: data as unknown as ServiceAccount,
      resource: { connectionID: 'ctx-1', id: 'my-app', key: 'core::v1::ServiceAccount' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- Minimal ----------------------------------------------------------------

const minimalData: ServiceAccount = {
  ...(data as unknown as ServiceAccount),
  metadata: { ...data.metadata, name: 'minimal-sa' },
  automountServiceAccountToken: false,
  secrets: undefined,
  imagePullSecrets: undefined,
};

export const Minimal: Story = {
  args: {
    ctx: {
      data: minimalData,
      resource: { connectionID: 'ctx-1', id: 'minimal-sa', key: 'core::v1::ServiceAccount' },
    },
  },
  decorators: withDrawer('minimal-sa'),
};
