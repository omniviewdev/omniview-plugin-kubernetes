import type { Meta, StoryObj } from '@storybook/react-vite';
import ObjectMetaSection from './ObjectMetaSection';

const meta = {
  title: 'Shared/ObjectMetaSection',
  component: ObjectMetaSection,
  tags: ['autodocs'],
} satisfies Meta<typeof ObjectMetaSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullMetadata: Story = {
  args: {
    data: {
      name: 'frontend-deployment',
      namespace: 'production',
      uid: 'abc-123-def',
      resourceVersion: '98765',
      creationTimestamp: '2025-06-15T09:23:41Z',
      labels: { app: 'frontend', tier: 'web' },
      annotations: { 'meta.helm.sh/release-name': 'frontend' },
    },
  },
};

export const MinimalMetadata: Story = {
  args: {
    data: {
      name: 'simple-resource',
      creationTimestamp: '2025-12-01T00:00:00Z',
    },
  },
};

export const ClusterScoped: Story = {
  args: {
    data: {
      name: 'cluster-admin',
      uid: 'xyz-789',
      resourceVersion: '100',
      creationTimestamp: '2025-01-01T00:00:00Z',
      labels: { 'kubernetes.io/bootstrapping': 'rbac-defaults' },
      annotations: {},
    },
  },
};
