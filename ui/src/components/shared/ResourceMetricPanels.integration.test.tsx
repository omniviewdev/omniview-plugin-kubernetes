import type { DrawerContext } from '@omniviewdev/runtime';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  observe: vi.fn(), update: vi.fn().mockResolvedValue(undefined),
  reference: { address: { provider: 'kubernetes', authority: 'owner', type: 'k8s:/pods', id: 'api', scope: [{ dimension: 'namespace', value: 'apps' }] }, incarnation: 'uid' },
  source: { plugin_id: 'grafana', connection_id: 'monitoring', datasource_uid: 'prom', datasource_kind: 'prometheus', native: false },
  bindingSource: { plugin_id: 'grafana', connection_id: 'old-monitoring', datasource_uid: 'old-prom', datasource_kind: 'prometheus', native: false },
  display: 'value',
  fetching: false,
  metricID: 'cpu',
  shapes: ['current', 'range'] as string[],
  refresh: vi.fn(),
}));
vi.mock('@omniviewdev/runtime', () => ({
  parseAppError: () => ({ code: '', title: '', detail: '' }),
  useMetricOwnerConnection: () => ({ name: 'Production' }),
  useMetricViewSourceSelection: () => ({ selection: { mode: 'external', source: state.source }, isLoading: false, error: null }),
  useMetricSourcePresentation: () => ({ providerName: 'Grafana', providerIcon: 'SiGrafana', label: 'Observability · Production Prometheus' }),
  useMetricBindings: () => ({ data: [{ id: 'binding', signal: 'metrics', resource_plugin_id: 'kubernetes', resource_connection_id: 'owner', source: state.bindingSource, public_scope: { cluster: 'production' } }] }),
  useMetricCatalog: () => ({ data: { source: state.source, metrics: [{ id: state.metricID, name: 'CPU', unit: 'cores', shapes: state.shapes, description: 'CPU usage' }] }, isLoading: false, error: null }),
  useMetricViewPreferences: () => ({ preferences: { metric_ids: [state.metricID], displays: { [state.metricID]: state.display }, details: { [state.metricID]: true }, layout: 'stack', time_mode: 'relative', duration_ms: 3600000 }, update: state.update, isLoading: false, error: null }),
  useMetricObservation: (input: { shape: string }) => {
    state.observe(input);
    const current = input.shape === 'current';
    return { results: [{ id: current ? 'current' : 'history', metricID: state.metricID, resourceToken: 'api', status: 'ok',
      value: current ? 0 : null, unit: { kind: 'cpu', base: 'cores' }, resourceReference: state.reference,
      points: current ? [] : [{ timeMs: 1000, value: 3 }], observedAt: current ? 2000 : null,
      freshUntilMs: current ? 17000 : null, freshness: 'fresh', identityScope: 'incarnation', dimensions: {}, windowMs: 0,
    }], domain: { startMs: 1000, endMs: 3000 }, isLoading: false, isFetching: state.fetching, error: null, refresh: state.refresh };
  },
}));
vi.mock('./MetricSourcePicker', () => ({ default: () => null }));
import ResourceMetricPanels from './ResourceMetricPanels';
import { PodMetricsView } from '../kubernetes/sidebar/Pod/PodMetricsSection';

afterEach(() => {
  cleanup(); state.observe.mockClear(); state.update.mockClear(); state.refresh.mockClear();
  state.display = 'value'; state.fetching = false; state.metricID = 'cpu'; state.shapes = ['current', 'range'];
});

it('composes real display controls, zero scalar, identity chips, and both sample rows', () => {
  render(<ResourceMetricPanels connectionID="owner" resourceKey="k8s:/pods" resourceID="api"
    identityLabels={(result, scope) => ({ cluster: scope.cluster ?? '', pod: result?.resourceReference.address.id ?? '' })} />);
  const picker = screen.getByRole('group', { name: 'CPU display' });
  expect(within(picker).getAllByRole('button')).toHaveLength(4);
  expect(within(picker).getByRole('button', { name: 'Value' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(within(picker).getByRole('button', { name: 'Line' }));
  expect(state.update).toHaveBeenCalledWith({ displays: { cpu: 'line' } });
  expect(screen.queryByRole('button', { name: /Move .* earlier/ })).toBeNull();
  expect(screen.getByText('0')).toBeTruthy();
  expect(screen.getByText('Observability · Production Prometheus')).toBeTruthy();
  expect(screen.getByTitle('cluster: production')).toBeTruthy();
  expect(screen.getByTitle('pod: api')).toBeTruthy();
  const freshness = screen.getByRole('table', { name: 'Sample freshness' });
  expect(within(freshness).getAllByRole('row')).toHaveLength(3);
  const history = within(freshness).getByRole('rowheader', { name: /History/ }).closest('tr')!;
  expect(within(history).getAllByRole('cell')[1]).toHaveTextContent('—');
  expect(state.observe.mock.calls.map(([input]) => input).filter(input => input.enabled)).toEqual([
    expect.objectContaining({ shape: 'current', metricIDs: ['cpu'] }),
    expect.objectContaining({ shape: 'range', metricIDs: ['cpu'] }),
  ]);
});

it('keeps the real history chart mounted while a shared observation refreshes', () => {
  state.display = 'area';
  const props = { connectionID: 'owner', resourceKey: 'k8s:/pods', resourceID: 'api' };
  const app = render(<ResourceMetricPanels {...props} />);
  const chart = screen.getByRole('application', { name: /^CPU history/ });
  chart.focus();
  state.fetching = true;
  app.rerender(<ResourceMetricPanels {...props} />);
  expect(screen.getByRole('application', { name: /^CPU history/ })).toBe(chart);
  expect(chart).toHaveFocus();
  expect(screen.getByText('Updating…')).toBeTruthy();
});

const podContext = (request: string | undefined, limit: string | undefined): DrawerContext<unknown> => ({
  data: { metadata: { name: 'api', namespace: 'apps' }, spec: { containers: [
    { name: 'app', resources: { requests: request == null ? undefined : { cpu: request }, limits: limit == null ? undefined : { cpu: limit } } },
  ] } },
  resource: { reference: state.reference, route: { connection: 'owner' } },
} as unknown as DrawerContext<unknown>);


it('shows real zero request with unknown native capacity instead of inventing an unlimited limit', () => {
  state.metricID = 'kubernetes.pod.cpu.usage';
  state.shapes = ['current'];
  state.display = 'capacity';
  render(<PodMetricsView ctx={podContext('0', '0')} />);
  expect(state.observe.mock.calls.map(([input]) => input).filter(input => input.enabled)).toEqual([
    expect.objectContaining({
      ownerPluginID: 'kubernetes', ownerConnectionID: 'owner', resourceKey: 'k8s:/pods',
      targets: [{ token: 'api', reference: state.reference, route: { connection: 'owner' } }],
      metricIDs: ['kubernetes.pod.cpu.usage'], shape: 'current',
    }),
  ]);
  expect(screen.getByLabelText('Current configuration references')).toHaveTextContent(/Request:.*0/);
  expect(within(screen.getByLabelText('Current configuration references')).getAllByTitle(/Current resource configuration/).length).toBeGreaterThan(0);
  expect(screen.getByText(/No bound supplied/)).toBeTruthy();
  expect(screen.getByLabelText('Current configuration references')).not.toHaveTextContent('Limit:');
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.queryByRole('application')).toBeNull();
});
