import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NodePodsSection from './NodePodsSection';

const mocks = vi.hoisted(() => ({ query: vi.fn(), retry: vi.fn() }));
vi.mock('../../../../hooks/useKubernetesResources', () => ({ useKubernetesResources: mocks.query }));
vi.mock('../../../shared/ResourceLinkChip', () => ({
  default: (props: { connectionID: string; namespace: string; resourceID: string; incarnation?: string }) => (
    <div>{[props.connectionID, props.namespace, props.resourceID, props.incarnation].join(':')}</div>
  ),
}));

describe('NodePodsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReturnValue({ bodies: [], isLoading: false, error: undefined, retry: mocks.retry });
  });

  it('shows only pods assigned to the node with namespace and navigation identity', () => {
    mocks.query.mockReturnValue({
      bodies: [
        { metadata: { name: 'web', namespace: 'team-a', uid: 'uid-a' }, spec: { nodeName: 'node-a' } },
        { metadata: { name: 'web', namespace: 'team-b', uid: 'uid-b' }, spec: { nodeName: 'node-a' } },
        { metadata: { name: 'other', namespace: 'team-a' }, spec: { nodeName: 'node-b' } },
        { metadata: { name: 'pending', namespace: 'team-a' }, spec: {} },
        { metadata: { name: 'completed', namespace: 'team-a' }, spec: { nodeName: 'node-a' }, status: { phase: 'Succeeded' } },
        { metadata: { name: 'failed', namespace: 'team-a' }, spec: { nodeName: 'node-a' }, status: { phase: 'Failed' } },
      ], isLoading: false, error: undefined, retry: mocks.retry,
    });
    render(<NodePodsSection connectionID="cluster" nodeName="node-a" />);
    expect(mocks.query).toHaveBeenCalledWith({ connectionID: 'cluster', resourceType: 'k8s:/pods', enabled: true });
    expect(screen.getByText('cluster:team-a:web:uid-a')).toBeInTheDocument();
    expect(screen.getByText('cluster:team-b:web:uid-b')).toBeInTheDocument();
    expect(screen.queryByText(/other|pending|completed|failed/)).toBeNull();
  });

  it('shows loading, empty and unavailable states', () => {
    mocks.query.mockReturnValue({ bodies: [], isLoading: true, error: undefined, retry: mocks.retry });
    const view = render(<NodePodsSection connectionID="cluster" nodeName="node-a" />);
    expect(screen.getByText('Loading pods...')).toBeInTheDocument();
    mocks.query.mockReturnValue({ bodies: [], isLoading: false, error: undefined, retry: mocks.retry });
    view.rerender(<NodePodsSection connectionID="cluster" nodeName="node-a" />);
    expect(screen.getByText('No active pods assigned to this node.')).toBeInTheDocument();
    view.rerender(<NodePodsSection connectionID="" nodeName="node-a" />);
    expect(screen.getByText('Pod lookup unavailable.')).toBeInTheDocument();
    expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('shows errors instead of a misleading loading or empty state and retries', () => {
    mocks.query.mockReturnValue({ bodies: [], isLoading: true, error: new Error('denied'), retry: mocks.retry });
    render(<NodePodsSection connectionID="cluster" nodeName="node-a" />);
    expect(screen.getByText('Unable to load pods for this node.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
});
