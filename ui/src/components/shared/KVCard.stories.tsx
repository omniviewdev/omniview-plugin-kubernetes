import type { Meta, StoryObj } from '@storybook/react-vite';
import KVCard from './KVCard';

const meta = {
  title: 'Shared/KVCard',
  component: KVCard,
  tags: ['autodocs'],
} satisfies Meta<typeof KVCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Labels: Story = {
  args: {
    title: 'Labels',
    kvs: { app: 'frontend', tier: 'web', 'app.kubernetes.io/managed-by': 'Helm' },
  },
};

export const Annotations: Story = {
  args: {
    title: 'Annotations',
    kvs: { 'meta.helm.sh/release-name': 'frontend', 'meta.helm.sh/release-namespace': 'default' },
  },
};

export const ManyPairs: Story = {
  args: {
    title: 'Environment',
    kvs: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`KEY_${i}`, `value-${i}`])),
  },
};

export const DefaultExpanded: Story = {
  args: {
    title: 'Selector',
    kvs: { app: 'my-app', version: 'v2' },
    defaultExpanded: true,
  },
};
