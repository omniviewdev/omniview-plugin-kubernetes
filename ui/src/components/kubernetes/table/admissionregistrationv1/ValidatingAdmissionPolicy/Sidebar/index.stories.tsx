import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ValidatingAdmissionPolicy } from 'kubernetes-types/admissionregistration/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { ValidatingAdmissionPolicySidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/admissionregistrationv1/ValidatingAdmissionPolicySidebar',
  component: ValidatingAdmissionPolicySidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof ValidatingAdmissionPolicySidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shared decorator factory — all ValidatingAdmissionPolicy stories use the same container shell. */
function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="admissionregistration::v1::ValidatingAdmissionPolicy"
        icon="LuShieldCheck"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

// -- Primary (full mock) ----------------------------------------------------

export const Primary: Story = {
  args: {
    ctx: {
      data: data as unknown as ValidatingAdmissionPolicy,
      resource: { connectionID: 'ctx-1', id: 'deny-privileged-containers', key: 'admissionregistration::v1::ValidatingAdmissionPolicy' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- Minimal (single validation, no audit/variables) ------------------------

const minimalData = {
  ...(data as unknown as ValidatingAdmissionPolicy),
  metadata: { ...data.metadata, name: 'minimal-policy' },
  spec: {
    failurePolicy: 'Ignore',
    matchConstraints: {
      resourceRules: [
        { operations: ['CREATE'], apiGroups: [''], apiVersions: ['v1'], resources: ['pods'] },
      ],
    },
    validations: [
      { expression: 'object.metadata.labels.exists(l, l == "team")', message: 'Team label is required' },
    ],
  },
  status: {},
} as unknown as ValidatingAdmissionPolicy;

export const Minimal: Story = {
  args: {
    ctx: {
      data: minimalData,
      resource: { connectionID: 'ctx-1', id: 'minimal-policy', key: 'admissionregistration::v1::ValidatingAdmissionPolicy' },
    },
  },
  decorators: withDrawer('minimal-policy'),
};
