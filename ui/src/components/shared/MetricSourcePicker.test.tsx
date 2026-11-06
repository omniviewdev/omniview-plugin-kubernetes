import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@omniviewdev/runtime', () => ({
  useMetricViewSourceSelection: () => ({
    selection: { mode: 'inherit' }, isLoading: false, isSaving: false, error: null,
    update: vi.fn().mockResolvedValue(undefined),
  }),
  parseAppError: (error: Error) => ({ title: 'Unavailable', detail: error.message }),
}));
vi.mock('@omniviewdev/runtime/api', () => ({
  MetricClient: {
    GetProviders: async () => [
      { plugin_id: 'kubernetes', supports_connections: false },
      { plugin_id: 'grafana', supports_connections: true },
    ],
    GetProviderConnections: async (plugin: string) => {
      if (plugin === 'kubernetes') throw new Error('Native metrics have no provider configuration.');
      return [{ id: 'kind-monitoring', name: 'Kind monitoring' }];
    },
    GetDataSources: async () => [{ uid: 'prometheus', name: 'Prometheus', kind: 'prometheus' }],
  },
}));

import MetricSourcePicker from './MetricSourcePicker';

afterEach(cleanup);

it('offers external sources without reporting native-only providers as unavailable', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>
    <MetricSourcePicker ownerPluginID="kubernetes" ownerConnectionID="kind-kind" resourceKey="k8s:/pods" />
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole('combobox', { name: 'Metric source' }));
  expect(await screen.findByRole('option', { name: 'External · Kind monitoring · Prometheus (grafana)' })).toBeTruthy();
  expect(screen.queryByText(/provider source catalogs unavailable|Native metrics have no provider configuration/)).toBeNull();
  expect(screen.getByRole('option', { name: 'Native' })).toBeTruthy();
  client.clear();
});
