import type { types } from '@omniviewdev/runtime/models';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ClusterConnectionDetails from './ClusterConnectionDetails';

const connectionID = 'arn:aws:eks:us-east-1:123456789012:cluster/production-platform-with-a-long-unambiguous-name';
function savedConnection(fields: Partial<types.Connection> = {}): types.Connection {
  return {
    id: connectionID,
    name: 'production-platform',
    description: 'Saved description',
    labels: {},
    data: {},
    ...fields,
  } as types.Connection;
}

describe('ClusterConnectionDetails', () => {
  it('shows explicit saved identity fields and complete route ID, not credentials or arbitrary metadata', () => {
    const connection = savedConnection({
      labels: {
        cluster: connectionID,
        context: 'production-admin',
        user: 'platform-operator',
        kubeconfig: '~/.kube/production.yaml',
        password: 'label-password-secret',
        team: 'arbitrary-label-value',
      },
      data: {
        token: 'bearer-token-secret',
        password: 'password-secret',
        clientKey: 'private-key-secret',
        kubeconfigContents: 'raw-kubeconfig-secret',
        arbitrary: 'arbitrary-data-value',
      },
    });
    const { container } = render(<ClusterConnectionDetails connectionID={connectionID} connection={connection} />);
    expect(screen.getByText('Amazon EKS')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'production-platform' })).toBeInTheDocument();
    expect(screen.getByText('Saved description')).toBeInTheDocument();
    expect(screen.getByText('production-admin')).toBeInTheDocument();
    expect(screen.getByText('platform-operator')).toBeInTheDocument();
    expect(screen.getByText('~/.kube/production.yaml')).toBeInTheDocument();
    expect(screen.getByText('Connection ID').nextElementSibling).toHaveTextContent(connectionID);
    for (const secret of ['label-password-secret', 'arbitrary-label-value', 'bearer-token-secret', 'password-secret', 'private-key-secret', 'raw-kubeconfig-secret', 'arbitrary-data-value']) {
      expect(container).not.toHaveTextContent(secret);
    }
  });

  it('uses display name and description overrides', () => {
    render(
      <ClusterConnectionDetails
        connectionID={connectionID}
        connection={savedConnection()}
        override={{ displayName: 'Production platform', description: 'Customer workloads', avatar: '/cluster-avatar.png' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Production platform' })).toBeInTheDocument();
    expect(screen.getByText('Customer workloads')).toBeInTheDocument();
    expect(screen.queryByText('Saved description')).not.toBeInTheDocument();
  });

  it('keeps the saved context visible under a custom display name without repeating the connection ID', () => {
    render(
      <ClusterConnectionDetails
        connectionID={connectionID}
        connection={savedConnection({ name: 'production-reader-context', labels: { cluster: connectionID } })}
        override={{ displayName: 'Production platform' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Production platform' })).toBeInTheDocument();
    expect(screen.getByText('Context').nextElementSibling).toHaveTextContent('production-reader-context');
    expect(screen.getAllByText(connectionID)).toHaveLength(1);
  });

  it('uses override avatar color and allows an intentionally empty description', () => {
    const { container } = render(
      <ClusterConnectionDetails
        connectionID={connectionID}
        connection={savedConnection()}
        override={{ displayName: 'Production platform', description: '', avatarColor: '#123456' }}
      />,
    );
    expect(screen.getByText('PP')).toHaveStyle({ backgroundColor: '#123456' });
    expect(container).not.toHaveTextContent('Saved description');
  });

  it('falls back to allowlisted data fields and ignores non-string values', () => {
    render(<ClusterConnectionDetails connectionID="route-id" connection={savedConnection({
      labels: { cluster: '' },
      data: { cluster: 'kind-local', context: 'local-context', user: { token: 'never-render-this' }, kubeconfig: '/home/dev/.kube/config' },
    })} />);
    expect(screen.getByText('kind-local')).toBeInTheDocument();
    expect(screen.getByText('local-context')).toBeInTheDocument();
    expect(screen.queryByText('Auth user')).not.toBeInTheDocument();
    expect(screen.queryByText('never-render-this')).not.toBeInTheDocument();
  });

  it('keeps exact opaque route ID visible without saved metadata', () => {
    const id = 'opaque:connection/7f3c9a2e?context=prod%2Fwest';
    render(<ClusterConnectionDetails connectionID={id} />);
    expect(screen.getByText(id)).toBeInTheDocument();
    expect(screen.getByText('No saved connection details are available.')).toBeInTheDocument();
  });

  it('keeps route ID visible while metadata loads or fails', () => {
    const { rerender } = render(<ClusterConnectionDetails connectionID={connectionID} isLoading />);
    expect(screen.getByText(connectionID)).toBeInTheDocument();
    expect(screen.getByText('Loading saved connection details…')).toBeInTheDocument();
    rerender(<ClusterConnectionDetails connectionID={connectionID} metadataError />);
    expect(screen.getByText(connectionID)).toBeInTheDocument();
    expect(screen.getByText('Saved details are unavailable. You can still check or connect using this connection ID.')).toBeInTheDocument();
  });
});
