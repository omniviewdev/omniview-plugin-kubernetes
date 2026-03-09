import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Condition } from 'kubernetes-types/meta/v1';
import JobStatusSection from './JobStatusSection';

const cond = (overrides: Partial<Condition> & { type: string; status: string }): Condition => ({
  lastTransitionTime: '2025-01-01T00:00:00Z',
  message: '',
  reason: '',
  ...overrides,
});

const meta = {
  title: 'Shared/JobStatusSection',
  component: JobStatusSection,
  tags: ['autodocs'],
} satisfies Meta<typeof JobStatusSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Complete: Story = {
  args: {
    status: { succeeded: 1, failed: 0, active: 0, startTime: '2025-01-01T10:00:00Z', completionTime: '2025-01-01T10:05:00Z' },
  },
};

export const Running: Story = {
  args: {
    status: { active: 2, succeeded: 0, failed: 0, startTime: '2025-01-01T10:00:00Z' },
  },
};

export const Failed: Story = {
  args: {
    status: { failed: 3, succeeded: 0, active: 0, startTime: '2025-01-01T10:00:00Z' },
    conditions: [
      cond({ type: 'Failed', status: 'True', message: 'BackoffLimitExceeded', reason: 'BackoffLimitExceeded' }),
    ],
  },
};

export const Pending: Story = {
  args: {
    status: { active: 0, succeeded: 0, failed: 0 },
  },
};

export const WithConditions: Story = {
  args: {
    status: { succeeded: 1, active: 0, failed: 0, startTime: '2025-01-01T10:00:00Z', completionTime: '2025-01-01T10:02:00Z' },
    conditions: [
      cond({ type: 'Complete', status: 'True' }),
    ],
  },
};
