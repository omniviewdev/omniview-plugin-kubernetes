import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const metadata = vi.hoisted(() => ({ transportAvailable: true, snapshot: { connectionID: 'owned', generation: '1', revision: '1', active: true, refreshing: false, entries: {
  'kubernetes.server_version': { state: 'current', value: 'v1.34', observedAt: '2026-10-31T10:00:00Z' },
  'kubernetes.server_platform': { state: 'unavailable', error: { code: 'FAILED', message: 'Platform not reported' } },
  'kubernetes.provider': { state: 'current', value: 'kind', observedAt: '2026-10-31T10:00:00Z' },
  'kubernetes.provider_source': { state: 'current', value: 'connection_config', observedAt: '2026-10-31T10:00:00Z' },
} } }));
vi.mock('@omniviewdev/runtime', () => ({ useConnectionMetadata: () => metadata }));
import ClusterInfoCard from './ClusterInfoCard';

describe('overview connection facts', () => {
  beforeEach(() => { metadata.transportAvailable = true; });
  it('downgrades retained values when metadata transport disappears', () => {
    metadata.transportAvailable = false;
    render(<ClusterInfoCard connectionID="owned" nodes={[]} pods={[]} events={[]} />);
    expect(screen.getByText('v1.34')).toBeTruthy();
    expect(screen.getByText('kind')).toBeTruthy();
    expect(screen.getByLabelText(/kind\. Inferred from mutable connection configuration; not verified hosting\. Saved observation/)).toBeTruthy();
    expect(screen.getByRole('img', { name: /Kubernetes version: Saved observation/ })).toBeTruthy();
  });
});
