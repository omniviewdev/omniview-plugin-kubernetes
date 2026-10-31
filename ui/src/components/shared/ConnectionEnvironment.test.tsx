import { render, screen } from '@testing-library/react';
import type { ConnectionMetadataSnapshot } from '@omniviewdev/runtime';
import { describe, expect, it } from 'vitest';
import ConnectionEnvironment from './ConnectionEnvironment';


function snapshot(values: Record<string, string>): ConnectionMetadataSnapshot {
  return {
    connectionID: 'kind-kind', generation: '1', revision: '1', active: true, refreshing: false,
    entries: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
      state: 'current', value, observedAt: '2026-10-31T10:00:00Z',
    }])),
  } as ConnectionMetadataSnapshot;
}

it('keeps location provenance separate from server-version provider inference', () => {
  render(<ConnectionEnvironment snapshot={snapshot({
    'kubernetes.provider': 'eks', 'kubernetes.provider_source': 'server_version', 'aws.region': 'us-east-1',
  })} transportAvailable={false} />);
  expect(screen.getByLabelText(/Amazon EKS\. Inferred from the API server version/)).toBeTruthy();
  expect(screen.getByLabelText(/Region: us-east-1\. Inferred from available connection details; not verified hosting\. Saved observation/)).toBeTruthy();
});

describe('connection environment hints', () => {
  it('shows kind from metadata with focusable configuration provenance and stale state', () => {
    render(<ConnectionEnvironment snapshot={snapshot({ 'kubernetes.provider': 'kind', 'kubernetes.provider_source': 'connection_config' })} transportAvailable={false} />);
    expect(screen.getByText('kind')).toBeTruthy();
    const badge = screen.getByLabelText(/kind\. Inferred from mutable connection configuration; not verified hosting\. Saved observation/);
    expect(badge.tabIndex).toBe(0);
  });

  it('hides absent and unknown optional hints', () => {
    const { container } = render(<ConnectionEnvironment snapshot={snapshot({ 'kubernetes.provider': 'unknown' })} transportAvailable />);
    expect(container.childElementCount).toBe(0);
  });

  it('shows a distinct distribution, location, and cloud fallback without identifiers in overview', () => {
    render(<ConnectionEnvironment snapshot={snapshot({ 'cloud.provider': 'aws', 'kubernetes.distribution': 'rke2', 'kubernetes.distribution_source': 'server_version', 'aws.region': 'us-east-1', 'aws.account_id': '123456789012' })} transportAvailable />);
    expect(screen.getByText('AWS')).toBeTruthy();
    expect(screen.getByText('RKE2')).toBeTruthy();
    expect(screen.getByText('us-east-1')).toBeTruthy();
    expect(screen.queryByText('123456789012')).toBeNull();
  });

  it('deduplicates matching provider and distribution badges', () => {
    render(<ConnectionEnvironment snapshot={snapshot({ 'kubernetes.provider': 'k3s', 'kubernetes.distribution': 'k3s' })} transportAvailable settings />);
    expect(screen.getAllByText('k3s')).toHaveLength(1);
  });
});
