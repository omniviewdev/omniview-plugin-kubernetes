import type { Meta, StoryObj } from '@storybook/react-vite';
import RBACRulesSection from './RBACRulesSection';

const meta = {
  title: 'Shared/RBACRulesSection',
  component: RBACRulesSection,
  tags: ['autodocs'],
} satisfies Meta<typeof RBACRulesSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleRule: Story = {
  args: {
    rules: [{ apiGroups: [''], resources: ['pods'], verbs: ['get', 'list', 'watch'] }],
  },
};

export const MultipleRules: Story = {
  args: {
    rules: [
      { apiGroups: [''], resources: ['pods', 'services'], verbs: ['get', 'list'] },
      { apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'list', 'create', 'update', 'delete'] },
      { apiGroups: ['batch'], resources: ['jobs', 'cronjobs'], verbs: ['*'] },
    ],
  },
};

export const WildcardAll: Story = {
  args: {
    rules: [{ apiGroups: ['*'], resources: ['*'], verbs: ['*'] }],
  },
};

export const NonResourceURLs: Story = {
  args: {
    rules: [{ nonResourceURLs: ['/healthz', '/readyz', '/metrics'], verbs: ['get'] }],
  },
};
