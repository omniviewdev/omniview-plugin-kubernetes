/// <reference types="@testing-library/jest-dom/vitest" />
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Node as K8sNode, Pod } from 'kubernetes-types/core/v1';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controlled hook results, not a runtime transport or native CPU benchmark.
const fixture = vi.hoisted(() => ({
  connectionID: 'cluster-a',
  results: {} as Record<string, { bodies?: Pod[]; isLoading: boolean; isError?: boolean }>,
  nodes: [] as K8sNode[],
  nodeState: { isLoading: false, isError: false, sourceError: false },
  nodeCoverage: 'exhausted',
  navigate: vi.fn(),
  ingest: vi.fn(),
  retry: vi.fn(),
}));

vi.mock('react-router', () => ({ useParams: () => ({ id: fixture.connectionID }) }));
vi.mock('@omniviewdev/runtime', () => ({
  usePluginRouter: () => ({ navigate: fixture.navigate }),
  useConnection: () => ({ connection: { data: { data: {} }, isLoading: false } }),
  useConnectionMetadata: () => ({ transportAvailable: true, supported: true, isLoading: false }),
  useExtensionPoint: () => undefined,
}));
vi.mock('../../../hooks/useKubernetesResources', () => ({
  useKubernetesResources: (request: { connectionID: string; resourceType: string }) => {
    fixture.ingest(request);
    const result = request.resourceType === 'k8s:/pods'
      ? fixture.results[request.connectionID]
      : { bodies: request.resourceType === 'k8s:/nodes' ? fixture.nodes : [], ...(request.resourceType === 'k8s:/nodes' ? fixture.nodeState : { isLoading: false }) };
    return {
      ...result,
      acquired: result.isLoading || result.isError ? undefined : { page: { view: { coverage: { enumeration: fixture.nodeCoverage } } } },
      error: result.isError ? new Error('Source unavailable') : undefined,
      retry: fixture.retry,
    };
  },
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
  fixture.navigate.mockClear();
  fixture.ingest.mockClear();
  fixture.retry.mockClear();
  fixture.nodes = [];
  fixture.nodeState = { isLoading: false, isError: false, sourceError: false };
  fixture.nodeCoverage = 'exhausted';
  fixture.results = {
    'cluster-a': {
      bodies: [
        pod('alpha', 'Running'), pod('alpha', 'Pending'), pod('beta', 'Failed'),
        pod('beta', 'Succeeded'), pod('beta'), pod('beta', 'Other'),
      ],
      isLoading: false,
    },
    'cluster-b': { bodies: [pod('alpha', 'Running')], isLoading: false },
  };
});
afterEach(cleanup);

function podCard() {
  return screen.getByRole('button', { name: /Pods/ });
}

describe('dashboard shared Pod result', () => {
  it('loads complete Node health only after explicit demand and resets demand on profile navigation', () => {
    fixture.nodes = [
      { status: { conditions: [{ type: 'Ready', status: 'True' }] } },
      { status: { conditions: [{ type: 'Ready', status: 'False' }] } },
      { status: { conditions: [{ type: 'Ready', status: 'Unknown' }] } },
    ];
    const view = render(<ClusterDashboardOverviewPage />);
    expect(screen.getByText('Nodes').parentElement).toHaveTextContent('Unknown');
    expect(screen.getByText(/Node health unknown/)).toBeInTheDocument();
    expect(fixture.ingest).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'k8s:/nodes', enabled: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Load Node health and count' }));
    expect(fixture.ingest).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'k8s:/nodes', enabled: true }));
    expect(screen.getByText('Nodes').parentElement).toHaveTextContent('3');
    expect(screen.getByText(/2 nodes not ready/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next page|previous page/i })).not.toBeInTheDocument();
    fixture.connectionID = 'cluster-b';
    view.rerender(<ClusterDashboardOverviewPage />);
    expect(screen.getByText('Nodes').parentElement).toHaveTextContent('Unknown');
    expect(screen.getByRole('button', { name: 'Load Node health and count' })).toBeInTheDocument();
  });

  it('keeps unavailable and loading Node counts unknown, but permits authoritative empty collections', () => {
    fixture.nodeState = { isLoading: true, isError: false, sourceError: false };
    const view = render(<ClusterDashboardOverviewPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Load Node health and count' }));
    expect(screen.getByText('Nodes').parentElement).toHaveTextContent('Unknown');
    fixture.nodeState = { isLoading: false, isError: true, sourceError: false };
    view.rerender(<ClusterDashboardOverviewPage />);
    expect(screen.getByText('Nodes').parentElement).toHaveTextContent('Unknown');
    expect(screen.getByText(/Node health unknown/)).toBeInTheDocument();
    fixture.nodeState = { isLoading: false, isError: false, sourceError: false };
    view.rerender(<ClusterDashboardOverviewPage />);
    expect(screen.getByText('Nodes').parentElement).toHaveTextContent('0');
    expect(screen.queryByText(/Node health unknown/)).not.toBeInTheDocument();
  });

  it('surfaces live source failure without trusting retained Node counts or promising source restart', () => {
    fixture.nodeState.sourceError = true;
    fixture.nodes = [{ status: { conditions: [{ type: 'Ready', status: 'True' }] } }];
    render(<ClusterDashboardOverviewPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Load Node health and count' }));
    expect(screen.getByText('Nodes').parentElement).toHaveTextContent('Unknown');
    expect(screen.getByRole('alert')).toHaveTextContent(/live.*source unavailable/i);
    expect(screen.getByText(/Node health unknown/).closest('[data-ov-color]')).toHaveAttribute('data-ov-color', 'danger');
    fireEvent.click(screen.getByRole('button', { name: 'Retry nodes' }));
    expect(fixture.retry).toHaveBeenCalledOnce();
  });

  it.each(['partial', 'unknown'])('never treats %s Node collection membership as a cluster total', (coverage) => {
    fixture.nodeCoverage = coverage;
    fixture.nodes = [{ status: { conditions: [{ type: 'Ready', status: 'False' }] } }];
    render(<ClusterDashboardOverviewPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Load Node health and count' }));
    expect(screen.getByText('Nodes').parentElement).toHaveTextContent('Unknown');
    expect(screen.getByText(/1 node not ready.*Node health incomplete/)).toBeInTheDocument();
  });

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
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('Source unavailable'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry pods' }));
    expect(fixture.retry).toHaveBeenCalledOnce();

    fixture.results['cluster-a'] = { bodies: [pod('alpha', 'Failed')], isLoading: false };
    view.rerender(<ClusterDashboardOverviewPage />);
    expect(podCard()).toHaveTextContent('1 Failed');
    expect(screen.getByText(/1 failed pod/)).toBeInTheDocument();

    fixture.connectionID = 'cluster-b';
    view.rerender(<ClusterDashboardOverviewPage />);
    expect(podCard()).toHaveTextContent('1 Running');
    expect(podCard()).not.toHaveTextContent('Failed');
    expect(screen.queryByText(/1 failed pod/)).not.toBeInTheDocument();
  });

  it('ingests Pods once and navigates using the canonical encoded resource route', () => {
    render(<ClusterDashboardOverviewPage />);
    expect(fixture.ingest.mock.calls.filter(([request]) => request.resourceType === 'k8s:/pods')).toHaveLength(1);
    expect(screen.queryByText(/source pages|not cluster totals|total unknown/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next page|previous page/i })).not.toBeInTheDocument();
    fireEvent.click(podCard());
    expect(fixture.navigate).toHaveBeenCalledWith('/cluster/cluster-a/resources/k8s%3A%2Fpods');
  });
});
