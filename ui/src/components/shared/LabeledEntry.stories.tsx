import type { Meta, StoryObj } from '@storybook/react-vite';
import LabeledEntry from './LabeledEntry';

const meta = {
  title: 'Shared/LabeledEntry',
  component: LabeledEntry,
  tags: ['autodocs'],
} satisfies Meta<typeof LabeledEntry>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StringValue: Story = {
  args: { label: 'Cluster IP', value: '10.96.0.1' },
};

export const ReactNodeValue: Story = {
  args: {
    label: 'Status',
    value: <span style={{ color: 'green', fontWeight: 600 }}>Running</span>,
  },
};

export const HiddenWhenUndefined: Story = {
  args: { label: 'External IP', value: undefined },
};

export const CustomLabelSize: Story = {
  args: { label: 'Provisioner', value: 'kubernetes.io/gce-pd', labelSize: 5 },
};
