import type { Meta, StoryObj } from '@storybook/react-vite';
import QuotaUsageTable from './QuotaUsageTable';

const meta = {
  title: 'Shared/QuotaUsageTable',
  component: QuotaUsageTable,
  tags: ['autodocs'],
} satisfies Meta<typeof QuotaUsageTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CPUAndMemory: Story = {
  args: {
    hard: { cpu: '4', memory: '8Gi' },
    used: { cpu: '2.5', memory: '5Gi' },
  },
};

export const FullQuota: Story = {
  args: {
    hard: { cpu: '2', memory: '4Gi', pods: '10', services: '5', 'requests.storage': '100Gi' },
    used: { cpu: '2', memory: '4Gi', pods: '10', services: '5', 'requests.storage': '100Gi' },
  },
};

export const PartialUsage: Story = {
  args: {
    hard: { cpu: '8', memory: '16Gi', pods: '50' },
    used: { cpu: '1', memory: '2Gi' },
  },
};
