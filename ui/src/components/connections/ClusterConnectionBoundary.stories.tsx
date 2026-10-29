import { ConnectionBoundaryFallback, type ConnectionReadiness } from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import ClusterConnectionDetails from './ClusterConnectionDetails';

const connectionID = 'arn:aws:eks:us-east-1:123456789012:cluster/production-platform';
const connection = new types.Connection({
  id: connectionID,
  name: 'production-platform',
  description: 'Customer workloads · US East (N. Virginia)',
  labels: {
    cluster: connectionID,
    context: 'production-platform-admin',
    user: 'platform-operator@production',
    kubeconfig: '~/.kube/production.yaml',
  },
});
const identity = <ClusterConnectionDetails connectionID={connectionID} connection={connection} override={{ displayName: 'Production platform', avatarColor: '#326CE5' }} />;

const createState = (phase: ConnectionReadiness['phase'], message?: string): ConnectionReadiness => ({
  phase,
  message,
  connect: async () => {},
  retry: async () => {},
});

const meta = {
  title: 'Connections/ConnectionBoundary',
  component: ConnectionBoundaryFallback,
  tags: ['autodocs'],
  args: {
    connectionDetails: identity,
    state: createState('disconnected'),
    onEditConnection: () => {},
    onBack: () => {},
  },
  parameters: {
    docs: { description: { component: 'Saved cluster identity remains visible during connection checks and recovery. These presentation-only previews make no backend or resource requests.' } },
  },
} satisfies Meta<typeof ConnectionBoundaryFallback>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Checking: Story = { args: { state: createState('checking') } };
export const Disconnected: Story = { args: { state: createState('disconnected') } };
export const Connecting: Story = { args: { state: createState('connecting') } };
export const Unauthorized: Story = {
  args: { state: createState('unauthorized', 'The cluster rejected the configured credentials. Refresh the token or edit the connection.') },
};
export const Forbidden: Story = {
  args: { state: createState('forbidden', 'The configured identity does not have permission to access this cluster.') },
};
export const NotFound: Story = {
  args: { state: createState('not-found', 'The saved connection was removed. No resource requests have been sent.') },
};
export const Error: Story = {
  args: { state: createState('error', 'Could not reach the API server: connection timed out.') },
};
export const MetadataLoading: Story = {
  args: {
    state: createState('checking'),
    connectionDetails: <ClusterConnectionDetails connectionID={connectionID} isLoading />,
  },
};
export const MissingMetadata: Story = {
  args: {
    state: createState('disconnected'),
    connectionDetails: <ClusterConnectionDetails connectionID="opaque-connection-7f3c9a2e" />,
  },
};
export const MetadataError: Story = {
  args: {
    state: createState('unauthorized', 'Authentication expired. Refresh credentials and try again.'),
    connectionDetails: <ClusterConnectionDetails connectionID={connectionID} metadataError />,
  },
};

async function previewDelay() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 600);
  await promise;
}

function RecoveryPreview() {
  const [phase, setPhase] = useState<ConnectionReadiness['phase']>('disconnected');
  const state: ConnectionReadiness = {
    phase,
    connect: async () => {
      setPhase('connecting');
      await previewDelay();
      setPhase('connected');
    },
    retry: async () => {
      setPhase('checking');
      await previewDelay();
      setPhase('disconnected');
    },
  };
  if (phase === 'connected') {
    return (
      <section aria-label="Mock cluster resources">
        <h2>Production platform · Pods</h2>
        <p>Storybook resource destination · namespace: production</p>
        <table>
          <thead><tr><th>Pod</th><th>Status</th><th>Ready</th></tr></thead>
          <tbody>
            <tr><td>checkout-api-7db6c9d4b8-k2j9p</td><td>Running</td><td>2/2</td></tr>
            <tr><td>payments-worker-6b8d7c5f94-r8n4s</td><td>Running</td><td>1/1</td></tr>
          </tbody>
        </table>
      </section>
    );
  }
  return <ConnectionBoundaryFallback state={state} connectionDetails={identity} />;
}

export const ConnectAndContinue: Story = {
  render: () => <RecoveryPreview />,
  parameters: { docs: { description: { story: 'Connect and continue replaces the splash with a Storybook-only pod table. Retry check only checks; it does not connect.' } } },
};
