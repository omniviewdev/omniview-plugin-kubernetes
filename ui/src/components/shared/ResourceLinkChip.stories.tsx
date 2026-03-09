import type { Meta, StoryObj } from '@storybook/react-vite';
import ResourceLinkChip from './ResourceLinkChip';

const meta = {
  title: 'Shared/ResourceLinkChip',
  component: ResourceLinkChip,
  tags: ['autodocs'],
} satisfies Meta<typeof ResourceLinkChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PodLink: Story = {
  args: {
    connectionID: 'ctx-1',
    namespace: 'default',
    resourceID: 'nginx-abc123',
    resourceKey: 'core::v1::Pod',
    resourceName: 'nginx-abc123',
  },
};

export const ServiceLink: Story = {
  args: {
    connectionID: 'ctx-1',
    namespace: 'production',
    resourceID: 'frontend',
    resourceKey: 'core::v1::Service',
    resourceName: 'frontend',
  },
};

export const SecretLink: Story = {
  args: {
    connectionID: 'ctx-1',
    namespace: 'default',
    resourceID: 'my-tls-secret',
    resourceKey: 'core::v1::Secret',
    resourceName: 'my-tls-secret',
  },
};
