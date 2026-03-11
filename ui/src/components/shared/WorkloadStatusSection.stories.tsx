import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Condition } from 'kubernetes-types/meta/v1';
import WorkloadStatusSection from './WorkloadStatusSection';

const cond = (overrides: Partial<Condition> & { type: string; status: string }): Condition => ({
  lastTransitionTime: '2025-01-01T00:00:00Z',
  message: '',
  reason: '',
  ...overrides,
});

const meta = {
  title: 'Shared/WorkloadStatusSection',
  component: WorkloadStatusSection,
  tags: ['autodocs'],
} satisfies Meta<typeof WorkloadStatusSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DeploymentReady: Story = {
  args: {
    title: 'Status',
    counts: [
      { label: 'Replicas', value: 3 },
      { label: 'Ready', value: 3 },
      { label: 'Available', value: 3 },
      { label: 'Updated', value: 3 },
    ],
    conditions: [
      cond({ type: 'Available', status: 'True' }),
      cond({ type: 'Progressing', status: 'True' }),
    ],
  },
};

export const WithConditions: Story = {
  args: {
    title: 'DaemonSet Status',
    counts: [
      { label: 'Desired', value: 5 },
      { label: 'Current', value: 5 },
      { label: 'Ready', value: 3 },
      { label: 'Available', value: 3 },
      { label: 'Unavailable', value: 2 },
    ],
    conditions: [
      cond({ type: 'Available', status: 'False', message: 'Not all pods are available', reason: 'MinimumReplicasUnavailable' }),
    ],
  },
};

export const Paused: Story = {
  args: {
    title: 'Status',
    paused: true,
    counts: [
      { label: 'Replicas', value: 3 },
      { label: 'Ready', value: 3 },
      { label: 'Available', value: 3 },
    ],
  },
};

export const ZeroCounts: Story = {
  args: {
    title: 'Status',
    counts: [
      { label: 'Replicas', value: 0 },
      { label: 'Ready', value: 0 },
    ],
  },
};
