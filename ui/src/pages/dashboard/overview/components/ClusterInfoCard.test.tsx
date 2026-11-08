import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const metadata = vi.hoisted(() => ({ transportAvailable: true, snapshot: { connectionID: 'owned', generation: '1', revision: '1', active: true, refreshing: false, entries: {
  'kubernetes.server_version': { state: 'current', value: 'v1.34', observedAt: '2026-10-31T10:00:00Z' },
  'kubernetes.server_platform': { state: 'unavailable', error: { code: 'FAILED', message: 'Platform not reported' } },
  'kubernetes.provider': { state: 'current', value: 'kind', observedAt: '2026-10-31T10:00:00Z' },
  'kubernetes.provider_source': { state: 'current', value: 'connection_config', observedAt: '2026-10-31T10:00:00Z' },
} } }));
vi.mock('@omniviewdev/runtime', () => ({ useConnectionMetadata: () => metadata }));
import ClusterInfoCard from './ClusterInfoCard';

describe('overview connection facts', () => {
  afterEach(cleanup);
  it.each([
    { nodes: undefined, nodeCount: undefined, color: 'warning' },
    { nodes: [], nodeCount: undefined, color: 'warning' },
    { nodes: [], nodeCount: 0, color: 'success' },
    { nodes: undefined, nodeCount: undefined, color: 'danger', pods: [{ status: { phase: 'Failed' } }] },
  ])('uses $color visual semantics for Node coverage and observed errors', ({ nodes, nodeCount, color, pods = [] }) => {
    render(<ClusterInfoCard connectionID="owned" nodes={nodes} nodeCount={nodeCount} pods={pods} events={[]} />);
    const chip = screen.getByText(/No issues observed|Issues:/).closest('[data-ov-color]')!;
    expect(chip.querySelector('svg')).toBeTruthy();
    expect(chip.getAttribute('data-ov-color')).toBe(color);
  });
  beforeEach(() => { metadata.transportAvailable = true; });
  it('downgrades retained values when metadata transport disappears', () => {
    metadata.transportAvailable = false;
    render(<ClusterInfoCard connectionID="owned" nodes={[]} pods={[]} events={[]} />);
    expect(screen.getByText('v1.34')).toBeTruthy();
    expect(screen.getByText('kind')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Kubernetes version: Saved observation/ })).toBeTruthy();
  });
  it('labels saved configured endpoints as configuration and keeps the clock for observations only', () => {
    metadata.snapshot.entries['kubernetes.server_url'] = { state: 'current', value: 'https://k8s.example', observedAt: '2026-10-31T10:00:00Z' };
    const view = render(<ClusterInfoCard connectionID="owned" nodes={[]} pods={[]} events={[]} />);
    expect(screen.getByRole('button', { name: 'API server: Configured endpoint' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kubernetes version: Observation details' })).toBeTruthy();
    view.unmount();
    metadata.transportAvailable = false;
    render(<ClusterInfoCard connectionID="owned" nodes={[]} pods={[]} events={[]} />);
    expect(screen.getByRole('button', { name: 'API server: Saved configured endpoint' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kubernetes version: Saved observation' })).toBeTruthy();
    delete (metadata.snapshot.entries as Record<string, unknown>)['kubernetes.server_url'];
  });
});
