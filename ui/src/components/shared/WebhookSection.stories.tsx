import type { Meta, StoryObj } from '@storybook/react-vite';
import WebhookSection from './WebhookSection';

const meta = {
  title: 'Shared/WebhookSection',
  component: WebhookSection,
  tags: ['autodocs'],
} satisfies Meta<typeof WebhookSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleWebhook: Story = {
  args: {
    webhooks: [{
      name: 'validate-pods.example.com',
      clientConfig: { service: { namespace: 'webhook-system', name: 'webhook-svc', path: '/validate', port: 443 } },
      failurePolicy: 'Fail',
      sideEffects: 'None',
      admissionReviewVersions: ['v1', 'v1beta1'],
      timeoutSeconds: 10,
      rules: [{ operations: ['CREATE', 'UPDATE'], apiGroups: [''], apiVersions: ['v1'], resources: ['pods'] }],
    }],
  },
};

export const MultipleWebhooks: Story = {
  args: {
    webhooks: [
      {
        name: 'validate-pods.example.com',
        clientConfig: { service: { namespace: 'system', name: 'svc', path: '/validate' } },
        failurePolicy: 'Fail',
        sideEffects: 'None',
        admissionReviewVersions: ['v1'],
      },
      {
        name: 'mutate-pods.example.com',
        clientConfig: { service: { namespace: 'system', name: 'svc', path: '/mutate' } },
        failurePolicy: 'Ignore',
        sideEffects: 'None',
        reinvocationPolicy: 'IfNeeded',
        admissionReviewVersions: ['v1'],
      },
    ],
  },
};

export const URLBased: Story = {
  args: {
    webhooks: [{
      name: 'external-webhook.example.com',
      clientConfig: { url: 'https://webhooks.example.com/validate' },
      failurePolicy: 'Ignore',
      sideEffects: 'None',
      admissionReviewVersions: ['v1'],
      timeoutSeconds: 30,
    }],
  },
};

export const WithRules: Story = {
  args: {
    webhooks: [{
      name: 'policy-webhook.example.com',
      clientConfig: { service: { namespace: 'policy', name: 'policy-svc', port: 8443 } },
      failurePolicy: 'Fail',
      sideEffects: 'None',
      matchPolicy: 'Equivalent',
      admissionReviewVersions: ['v1'],
      rules: [
        { operations: ['CREATE'], apiGroups: ['apps'], apiVersions: ['v1'], resources: ['deployments'], scope: 'Namespaced' },
        { operations: ['CREATE', 'UPDATE'], apiGroups: [''], apiVersions: ['v1'], resources: ['pods'], scope: '*' },
      ],
    }],
  },
};
