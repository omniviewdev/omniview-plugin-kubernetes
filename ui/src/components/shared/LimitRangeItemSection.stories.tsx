import type { Meta, StoryObj } from '@storybook/react-vite';
import LimitRangeItemSection from './LimitRangeItemSection';

const meta = {
  title: 'Shared/LimitRangeItemSection',
  component: LimitRangeItemSection,
  tags: ['autodocs'],
} satisfies Meta<typeof LimitRangeItemSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ContainerLimits: Story = {
  args: {
    limits: [{
      type: 'Container',
      default: { cpu: '500m', memory: '512Mi' },
      defaultRequest: { cpu: '100m', memory: '128Mi' },
      max: { cpu: '2', memory: '2Gi' },
      min: { cpu: '50m', memory: '64Mi' },
    }],
  },
};

export const PodLimits: Story = {
  args: {
    limits: [{ type: 'Pod', max: { cpu: '4', memory: '8Gi' }, min: { cpu: '100m', memory: '128Mi' } }],
  },
};

export const MultipleLimits: Story = {
  args: {
    limits: [
      { type: 'Container', default: { cpu: '500m', memory: '512Mi' }, max: { cpu: '2', memory: '2Gi' } },
      { type: 'Pod', max: { cpu: '4', memory: '8Gi' } },
      { type: 'PersistentVolumeClaim', max: { storage: '100Gi' }, min: { storage: '1Gi' } },
    ],
  },
};
