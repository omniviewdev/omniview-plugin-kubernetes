import type { Meta, StoryObj } from '@storybook/react-vite';
import type { PodDisruptionBudget } from 'kubernetes-types/policy/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { PodDisruptionBudgetSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/policyv1/PodDisruptionBudgetSidebar',
  component: PodDisruptionBudgetSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof PodDisruptionBudgetSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="policy::v1::PodDisruptionBudget"
        icon="LuShield"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

// -- MinAvailable (default mock) ------------------------------------------

export const MinAvailable: Story = {
  args: {
    ctx: {
      data: data as unknown as PodDisruptionBudget,
      resource: { connectionID: 'ctx-1', id: 'web-frontend-pdb', key: 'policy::v1::PodDisruptionBudget' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- MaxUnavailable -------------------------------------------------------

const maxUnavailableData: PodDisruptionBudget = {
  ...(data as unknown as PodDisruptionBudget),
  metadata: { ...data.metadata, name: 'api-pdb' },
  spec: {
    maxUnavailable: '25%',
    selector: {
      matchLabels: {
        app: 'api-server',
      },
    },
    unhealthyPodEvictionPolicy: 'AlwaysAllow',
  },
  status: {
    currentHealthy: 4,
    desiredHealthy: 3,
    disruptionsAllowed: 1,
    expectedPods: 4,
    observedGeneration: 2,
    conditions: [
      {
        type: 'DisruptionAllowed',
        status: 'True',
        lastTransitionTime: '2025-08-01T10:00:00Z',
        reason: 'SufficientPods',
        message: 'The disruption budget has sufficient pods',
      },
    ],
  },
};

export const MaxUnavailable: Story = {
  args: {
    ctx: {
      data: maxUnavailableData,
      resource: { connectionID: 'ctx-1', id: 'api-pdb', key: 'policy::v1::PodDisruptionBudget' },
    },
  },
  decorators: withDrawer('api-pdb'),
};
