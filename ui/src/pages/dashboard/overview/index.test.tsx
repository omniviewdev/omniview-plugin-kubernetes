/// <reference types="@testing-library/jest-dom/vitest" />
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Pod } from 'kubernetes-types/core/v1';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controlled hook results, not a runtime transport or native CPU benchmark.
const fixture = vi.hoisted(() => ({
  connectionID: 'cluster-a',
  results: {} as Record<string, { data?: { result: Pod[] }; isLoading: boolean; isError?: boolean }>,
}));

vi.mock('react-router', () => ({ useParams: () => ({ id: fixture.connectionID }) }));
vi.mock('@omniviewdev/runtime', () => ({
  usePluginRouter: () => ({ navigate: vi.fn() }),
  useConnection: () => ({ connection: { data: { data: {} }, isLoading: false } }),
  useExtensionPoint: () => undefined,
  useResources: ({ connectionID, resourceKey }: { connectionID: string; resourceKey: string }) => ({
    resources: resourceKey === 'core::v1::Pod'
      ? fixture.results[connectionID]
      : { data: { result: [] }, isLoading: false },
  }),
}));
vi.mock('../../../hooks/useClusterPreferences', () => ({
  useClusterPreferences: () => ({ connectionOverrides: {} }),
}));
vi.mock('../../../components/tables/NamespaceSelect', () => ({
  default: ({ setNamespaces }: { setNamespaces: (value: string[]) => void }) => (
    <select aria-label="Fixture namespace" onChange={(event) => setNamespaces(event.target.value ? [event.target.value] : [])}>
      <option value="">All</option>
      <option value="alpha">alpha</option>
      <option value="beta">beta</option>
    </select>
  ),
}));
vi.mock('./components/ClusterResourceGauges', () => ({ default: () => null }));
vi.mock('./components/ClusterMetricsSection', () => ({ default: () => null }));
vi.mock('./EventsTable', () => ({ default: () => null }));

import ClusterDashboardOverviewPage from './index';

function pod(namespace: string, phase?: string): Pod {
  return { metadata: { namespace }, status: { phase } };
}

beforeEach(() => {
  fixture.connectionID = 'cluster-a';
  fixture.results = {
    'cluster-a': {
      data: { result: [
        pod('alpha', 'Running'), pod('alpha', 'Pending'), pod('beta', 'Failed'),
        pod('beta', 'Succeeded'), pod('beta'), pod('beta', 'Other'),
      ] },
      isLoading: false,
    },
    'cluster-b': { data: { result: [pod('alpha', 'Running')] }, isLoading: false },
  };
});
afterEach(cleanup);

function podCard() {
  return screen.getByRole('button', { name: /Pods/ });
}

describe('dashboard shared Pod result', () => {
  it('keeps mixed phase totals and health aligned through namespace changes', () => {
    render(<ClusterDashboardOverviewPage />);
    expect(podCard()).toHaveTextContent('6');
    expect(podCard()).toHaveTextContent('1 Running, 1 Pending, 1 Failed, 1 Succeeded, 2 Unknown');
    expect(screen.getByText(/1 failed pod/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Fixture namespace'), { target: { value: 'alpha' } });
    expect(podCard()).toHaveTextContent('2');
    expect(podCard()).toHaveTextContent('1 Running, 1 Pending');
    expect(podCard()).not.toHaveTextContent('Failed');
    expect(screen.queryByText(/1 failed pod/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 pending pod/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Fixture namespace'), { target: { value: 'beta' } });
    expect(podCard()).toHaveTextContent('4');
    expect(podCard()).toHaveTextContent('1 Failed, 1 Succeeded, 2 Unknown');
    expect(screen.getByText(/1 failed pod/)).toBeInTheDocument();
  });

  it('uses the current result for loading, errors and connection changes', () => {
    fixture.results['cluster-a'] = { isLoading: true };
    const view = render(<ClusterDashboardOverviewPage />);
    expect(screen.queryByRole('button', { name: /Pods/ })).not.toBeInTheDocument();

    fixture.results['cluster-a'] = { isLoading: false, isError: true };
    view.rerender(<ClusterDashboardOverviewPage />);
    expect(podCard()).toHaveTextContent('0');
    expect(podCard()).toHaveTextContent('No active workloads');

    fixture.results['cluster-a'] = { data: { result: [pod('alpha', 'Failed')] }, isLoading: false };
    view.rerender(<ClusterDashboardOverviewPage />);
    expect(podCard()).toHaveTextContent('1 Failed');
    expect(screen.getByText(/1 failed pod/)).toBeInTheDocument();

    fixture.connectionID = 'cluster-b';
    view.rerender(<ClusterDashboardOverviewPage />);
    expect(podCard()).toHaveTextContent('1 Running');
    expect(podCard()).not.toHaveTextContent('Failed');
    expect(screen.queryByText(/1 failed pod/)).not.toBeInTheDocument();
  });
});
