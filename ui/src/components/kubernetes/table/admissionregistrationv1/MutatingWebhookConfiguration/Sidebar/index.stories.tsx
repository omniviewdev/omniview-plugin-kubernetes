import type { Meta, StoryObj } from '@storybook/react-vite';
import type { MutatingWebhookConfiguration } from 'kubernetes-types/admissionregistration/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { MutatingWebhookConfigurationSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/admissionregistrationv1/MutatingWebhookConfigurationSidebar',
  component: MutatingWebhookConfigurationSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof MutatingWebhookConfigurationSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shared decorator factory — all MutatingWebhookConfiguration stories use the same container shell. */
function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="admissionregistration::v1::MutatingWebhookConfiguration"
        icon="LuShield"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

// -- Primary (full mock) ----------------------------------------------------

export const Primary: Story = {
  args: {
    ctx: {
      data: data as unknown as MutatingWebhookConfiguration,
      resource: { connectionID: 'ctx-1', id: 'istio-sidecar-injector', key: 'admissionregistration::v1::MutatingWebhookConfiguration' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- Minimal ----------------------------------------------------------------

const minimalData: MutatingWebhookConfiguration = {
  ...(data as unknown as MutatingWebhookConfiguration),
  metadata: { ...data.metadata, name: 'minimal-mutator' },
  webhooks: [
    {
      name: 'mutate.minimal.example.com',
      clientConfig: {
        service: { namespace: 'default', name: 'minimal-svc', port: 443 },
      },
      sideEffects: 'None',
      admissionReviewVersions: ['v1'],
    },
  ],
};

export const Minimal: Story = {
  args: {
    ctx: {
      data: minimalData,
      resource: { connectionID: 'ctx-1', id: 'minimal-mutator', key: 'admissionregistration::v1::MutatingWebhookConfiguration' },
    },
  },
  decorators: withDrawer('minimal-mutator'),
};
