import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ValidatingWebhookConfiguration } from 'kubernetes-types/admissionregistration/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { ValidatingWebhookConfigurationSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/admissionregistrationv1/ValidatingWebhookConfigurationSidebar',
  component: ValidatingWebhookConfigurationSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof ValidatingWebhookConfigurationSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shared decorator factory — all ValidatingWebhookConfiguration stories use the same container shell. */
function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="admissionregistration::v1::ValidatingWebhookConfiguration"
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

// -- Primary (full mock with two webhooks) ----------------------------------

export const Primary: Story = {
  args: {
    ctx: {
      data: data as unknown as ValidatingWebhookConfiguration,
      resource: { connectionID: 'ctx-1', id: 'pod-policy-validator', key: 'admissionregistration::v1::ValidatingWebhookConfiguration' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- Minimal ----------------------------------------------------------------

const minimalData: ValidatingWebhookConfiguration = {
  ...(data as unknown as ValidatingWebhookConfiguration),
  metadata: { ...data.metadata, name: 'minimal-validator' },
  webhooks: [
    {
      name: 'validate.minimal.example.com',
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
      resource: { connectionID: 'ctx-1', id: 'minimal-validator', key: 'admissionregistration::v1::ValidatingWebhookConfiguration' },
    },
  },
  decorators: withDrawer('minimal-validator'),
};
