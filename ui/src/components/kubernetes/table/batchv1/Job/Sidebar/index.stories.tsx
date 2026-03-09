import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Job } from 'kubernetes-types/batch/v1';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { JobSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/batchv1/JobSidebar',
  component: JobSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof JobSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shared decorator factory — all Job stories use the same container shell. */
function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="batch::v1::Job"
        icon="LuPlay"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

// -- Complete (default mock) ------------------------------------------------

export const Complete: Story = {
  args: {
    ctx: {
      data: data as unknown as Job,
      resource: { connectionID: 'ctx-1', id: 'data-migration-v3', key: 'batch::v1::Job' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};

// -- Running ----------------------------------------------------------------

const runningData: Job = {
  ...(data as unknown as Job),
  metadata: { ...data.metadata, name: 'data-migration-v3' },
  status: {
    conditions: [],
    startTime: '2025-06-14T10:00:00Z',
    succeeded: 1,
    failed: 0,
    active: 2,
    ready: 2,
  },
};

export const Running: Story = {
  args: {
    ctx: {
      data: runningData,
      resource: { connectionID: 'ctx-1', id: 'data-migration-v3', key: 'batch::v1::Job' },
    },
  },
  decorators: withDrawer('data-migration-v3'),
};

// -- Failed -----------------------------------------------------------------

const failedData: Job = {
  ...(data as unknown as Job),
  metadata: { ...data.metadata, name: 'data-migration-v3' },
  status: {
    conditions: [
      {
        type: 'Failed',
        status: 'True',
        lastProbeTime: '2025-06-14T10:30:00Z',
        lastTransitionTime: '2025-06-14T10:30:00Z',
        reason: 'BackoffLimitExceeded',
        message: 'Job has reached the specified backoff limit',
      },
    ],
    startTime: '2025-06-14T10:00:00Z',
    succeeded: 1,
    failed: 4,
    active: 0,
    ready: 0,
  },
};

export const Failed: Story = {
  args: {
    ctx: {
      data: failedData,
      resource: { connectionID: 'ctx-1', id: 'data-migration-v3', key: 'batch::v1::Job' },
    },
  },
  decorators: withDrawer('data-migration-v3'),
};
