import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Condition } from 'kubernetes-types/meta/v1';
import { ConditionChip } from './ConditionChip';

const meta = {
  title: 'Shared/ConditionChip',
  component: ConditionChip,
  tags: ['autodocs'],
} satisfies Meta<typeof ConditionChip>;

export default meta;
type Story = StoryObj<typeof meta>;

const cond = (overrides: Partial<Condition> & { type: string; status: string }): Condition => ({
  lastTransitionTime: '2025-01-01T00:00:00Z',
  message: '',
  reason: '',
  ...overrides,
});

export const HealthyTrue: Story = {
  args: { condition: cond({ type: 'Available', status: 'True' }) },
};

export const UnhealthyFalse: Story = {
  args: { condition: cond({ type: 'Progressing', status: 'False', message: 'Deployment timed out', reason: 'ProgressDeadlineExceeded' }) },
};

export const Flipped: Story = {
  args: { condition: cond({ type: 'PodScheduled', status: 'False' }), flipped: true },
};

export const CustomColors: Story = {
  args: { condition: cond({ type: 'Ready', status: 'False' }), unhealthyColor: 'danger', healthyColor: 'neutral' },
};

export const WithMessage: Story = {
  args: { condition: cond({ type: 'MemoryPressure', status: 'True', message: 'Node is experiencing memory pressure', reason: 'KubeletHasInsufficientMemory' }) },
};
