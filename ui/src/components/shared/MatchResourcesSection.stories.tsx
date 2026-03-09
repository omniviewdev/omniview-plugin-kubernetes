import type { Meta, StoryObj } from '@storybook/react-vite';
import MatchResourcesSection from './MatchResourcesSection';

const meta = {
  title: 'Shared/MatchResourcesSection',
  component: MatchResourcesSection,
  tags: ['autodocs'],
} satisfies Meta<typeof MatchResourcesSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ResourceRules: Story = {
  args: {
    matchResources: {
      resourceRules: [
        { operations: ['CREATE', 'UPDATE'], apiGroups: ['apps'], apiVersions: ['v1'], resources: ['deployments'] },
      ],
    },
  },
};

export const ExcludeRules: Story = {
  args: {
    matchResources: {
      resourceRules: [{ operations: ['*'], apiGroups: ['*'], apiVersions: ['*'], resources: ['*'] }],
      excludeResourceRules: [{ operations: ['*'], apiGroups: [''], apiVersions: ['v1'], resources: ['configmaps'] }],
    },
  },
};

export const WithSelectors: Story = {
  args: {
    matchResources: {
      resourceRules: [{ operations: ['CREATE'], apiGroups: [''], apiVersions: ['v1'], resources: ['pods'] }],
      namespaceSelector: { matchLabels: { environment: 'production' } },
      objectSelector: { matchLabels: { 'policy.example.com/validate': 'true' } },
    },
  },
};
