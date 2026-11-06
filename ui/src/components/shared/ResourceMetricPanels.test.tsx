import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  observation: { results: [] as object[], domain: { startMs: 1000, endMs: 2000 }, isLoading: false, isFetching: false, error: null as Error | null, refresh: vi.fn() },
  currentObservation: { results: [] as object[], domain: null, isLoading: false, isFetching: false, error: null, refresh: vi.fn() },
  shapes: ['range'],
  mixed: false,
  timeMode: 'relative' as 'relative' | 'absolute',
  observe: vi.fn(),
  chart: vi.fn(),
  chartMounts: 0,
  extraMetrics: [] as Array<{ id: string; name: string; unit: string; shapes: string[]; description: string }>,
  selectedIDs: null as string[] | null,
  useDefaults: false,
  update: vi.fn().mockResolvedValue(undefined),
  defaults: vi.fn(),
  displays: {} as Record<string, string>,
  panel: vi.fn(),
  details: vi.fn(),
  parse: vi.fn(),
  normalizedError: { code: 'UNAVAILABLE', title: 'Metric unavailable', detail: 'The datasource rejected this query.' },
  catalogError: null as Error | null,
}));
vi.mock('@omniviewdev/runtime', () => ({
  parseAppError: (error: unknown) => { state.parse(error); return state.normalizedError; },
  useMetricViewSourceSelection: () => ({ selection: { mode: 'inherit', source: null }, isLoading: false, error: null }),
  useMetricCatalog: () => ({ data: { source: { datasource_kind: 'prometheus' }, metrics: [
    { id: 'cpu', name: 'CPU', unit: 'cores', shapes: state.shapes, description: 'CPU usage' },
    ...(state.mixed ? [{ id: 'native-memory', name: 'Native memory', unit: 'bytes', shapes: ['current'], description: 'Current memory' }] : []),
    ...state.extraMetrics,
  ] }, isLoading: false, error: state.catalogError }),
  useMetricViewPreferences: (_owner: string, _resource: string, initial: { metric_ids: string[] }) => {
    state.defaults(initial);
    return { preferences: { metric_ids: state.selectedIDs ?? (state.useDefaults ? initial.metric_ids : state.mixed ? ['cpu', 'native-memory'] : ['cpu']), displays: state.displays, details: {}, layout: 'stack', time_mode: state.timeMode, duration_ms: 3600000, start_ms: 1000, end_ms: 2000 }, update: state.update, isLoading: false, error: null };
  },
  useMetricObservation: (input: { shape: string }) => { state.observe(input); return input.shape === 'current' ? state.currentObservation : state.observation; },
}));
vi.mock('@omniviewdev/base-ui/metrics', () => ({
  MetricPanel: ({ children, title, actions, details, state: panelState }: { children: ReactNode; title: string; actions: ReactNode; details: { content: ReactNode }; state: unknown }) => {
    state.panel(panelState);
    return <section aria-label={title}><h2>{title}</h2>{actions}{children}{details.content}</section>;
  },
  MetricDetails: (props: unknown) => { state.details(props); return null; },
  MetricDisplayPicker: ({ label, options, onChange }: { label: string; options: { value: 'area' | 'line' | 'sample-bars' | 'stat' | 'capacity'; label: string }[]; onChange: (value: 'area' | 'line' | 'sample-bars' | 'stat' | 'capacity') => void }) =>
    <div>{options.map(option => <button key={option.value} aria-label={`${label}: ${option.label}`} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>,
  MetricValue: ({ value, size }: { value: number; size: string }) => <span data-size={size}>Value {value}</span>, CapacityBar: () => null,
  TimeRangeControl: () => <div>Time range</div>,
  TimeSeriesChart: (props: unknown) => { state.chart(props); useEffect(() => { state.chartMounts++; }, []); return <div>History chart</div>; },
}));
import ResourceMetricPanels from './ResourceMetricPanels';
vi.mock('./MetricSourcePicker', () => ({ default: () => <span>Metric source</span> }));
afterEach(() => {
  cleanup(); state.shapes = ['range']; state.mixed = false; state.timeMode = 'relative';
  state.chartMounts = 0; state.observe.mockClear(); state.chart.mockClear();
  state.observation.isFetching = false; state.observation.results = []; state.currentObservation.results = [];
  state.extraMetrics = []; state.selectedIDs = null; state.useDefaults = false; state.update.mockClear(); state.defaults.mockClear();
  state.displays = {}; state.panel.mockClear(); state.parse.mockClear(); state.observation.error = null; state.catalogError = null;
  state.details.mockClear();
  state.normalizedError.detail = 'The datasource rejected this query.';
});

it('keeps genuine history mounted during host refresh', () => {
  const view = render(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" resourceID="pod" />);
  expect(screen.getByText('History chart')).toBeTruthy();
  state.observation.isFetching = true;
  view.rerender(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" resourceID="pod" />);
  expect(state.chartMounts).toBe(1);
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({ shape: 'range', ownerConnectionID: 'cluster' });
});

it('never invents native sample history or a range control', () => {
  state.shapes = ['current'];
  render(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" resourceID="pod" />);
  expect(screen.queryByText('History chart')).toBeNull();
  expect(screen.queryByText('Time range')).toBeNull();
  expect(state.observe.mock.calls.map(([input]) => input).filter(input => input.enabled)).toEqual([
    expect.objectContaining({ shape: 'current', metricIDs: ['cpu'] }),
  ]);
});

it('labels native measurements without an invented datasource kind', () => {
  state.shapes = ['current'];
  state.currentObservation.results = [{ id: 'native', metricID: 'cpu', resourceToken: 'pod', status: 'ok', value: 2, points: [],
    source: { plugin_id: 'kubernetes', connection_id: 'cluster', native: true, datasource_kind: '', datasource_uid: '' } }];
  render(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" resourceID="pod" />);
  expect(state.details.mock.lastCall?.[0]).toMatchObject({ source: 'Native' });
});

it('groups mixed native and external selection into disjoint supported shapes', () => {
  state.mixed = true;
  state.currentObservation.results = [{ id: 'native', metricID: 'native-memory', resourceToken: 'pod', status: 'ok', value: 2, points: [] }];
  state.observation.results = [{ id: 'external', metricID: 'cpu', resourceToken: 'pod', status: 'ok', value: null, points: [{ timestamp: 1000, value: 3 }] }];
  render(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" resourceID="pod" />);
  const active = state.observe.mock.calls.map(([input]) => input).filter(input => input.enabled);
  expect(active).toEqual([
    expect.objectContaining({ shape: 'current', metricIDs: ['native-memory'] }),
    expect.objectContaining({ shape: 'range', metricIDs: ['cpu'], durationMs: 3600000 }),
  ]);
  expect(active[0]).not.toHaveProperty('durationMs');
  expect(active[1].startTime).toBeUndefined();
  expect(active[1].endTime).toBeUndefined();
  expect(screen.getByText('Value 2')).toBeTruthy();
  expect(screen.getByText('Value 3').getAttribute('data-size')).toBe('lg');
  expect(screen.getAllByText('History chart')).toHaveLength(1);
  expect(state.chart.mock.lastCall?.[0]).toMatchObject({
    mode: 'area',
    domain: { startMs: 1000, endMs: 2000 },
    series: [{ id: 'external', points: [{ timestamp: 1000, value: 3 }] }],
  });
});

it('keeps absolute bounds fixed without a relative duration', () => {
  state.timeMode = 'absolute';
  render(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" resourceID="pod" />);
  expect(state.observe.mock.lastCall?.[0]).toMatchObject({
    shape: 'range', startTime: new Date(1000).toISOString(), endTime: new Date(2000).toISOString(),
    durationMs: undefined,
  });
});

it.each([['area', 'Area'], ['line', 'Line'], ['sample-bars', 'Bars']] as const)('persists exact %s mode and restores it on another Pod', (mode, label) => {
  render(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" resourceID="pod-a" />);
  fireEvent.click(screen.getByRole('button', { name: `CPU display: ${label}` }));
  expect(state.update).toHaveBeenCalledWith({ displays: { cpu: mode } });
  cleanup();
  state.displays = { cpu: mode };
  render(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" resourceID="pod-b" />);
  expect(state.chart.mock.lastCall?.[0]).toMatchObject({ mode });
  fireEvent.click(screen.getByRole('button', { name: 'CPU display: Value' }));
  expect(state.update).toHaveBeenCalledWith({ displays: { cpu: 'value' } });
});


it('preserves native value and capacity presentation preferences', () => {
  state.shapes = ['current'];
  render(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" capacities={{ cpu: { limit: 2 } }} />);
  fireEvent.click(screen.getByRole('button', { name: 'CPU display: Capacity' }));
  expect(state.update).toHaveBeenCalledWith({ displays: { cpu: 'capacity' } });
  fireEvent.click(screen.getByRole('button', { name: 'CPU display: Value' }));
  expect(state.update).toHaveBeenCalledWith({ displays: { cpu: 'value' } });
});

it('normalizes serialized observation errors into compact meaningful panel status', () => {
  const error = new Error('RuntimeError: {"code":"UNAVAILABLE","message":"private serialized transport"}');
  state.observation.error = error;
  render(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" />);
  expect(state.parse).toHaveBeenCalledWith(error);
  expect(state.panel.mock.lastCall?.[0]).toMatchObject({ kind: 'error', message: 'The datasource rejected this query.' });
  expect(screen.queryByText(/RuntimeError|private serialized transport/)).toBeNull();
});

it.each(['failed', 'ambiguous', 'invalid_context', 'invalid_mapping'])('renders %s result as an error while another metric stays healthy', (status) => {
  state.mixed = true;
  state.normalizedError.detail = 'Namespace apps metrics scan failed.';
  state.observation.results = [{ id: 'failed-cpu', metricID: 'cpu', resourceToken: 'pod', status,
    value: null, points: [], message: 'Namespace apps metrics scan failed.' }];
  state.currentObservation.results = [{ id: 'healthy-memory', metricID: 'native-memory', resourceToken: 'pod',
    status: 'ok', value: 2, points: [] }];
  render(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" resourceID="pod" />);
  expect(state.observation.error).toBeNull();
  expect(state.parse).toHaveBeenCalledWith(expect.objectContaining({
    code: status.toUpperCase(), detail: 'Namespace apps metrics scan failed.',
  }));
  expect(state.panel.mock.calls.map(([panel]) => panel)).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'error', message: 'Namespace apps metrics scan failed.' }),
    expect.objectContaining({ kind: 'data' }),
  ]));
  expect(screen.getByText('Value 2')).toBeTruthy();
});

it('bounds failed-result status text while retaining the normalized diagnostic', () => {
  const diagnostic = 'Metric mapping could not resolve the configured identity. '.repeat(8);
  state.normalizedError.detail = diagnostic;
  state.observation.results = [{ id: 'failed-cpu', metricID: 'cpu', resourceToken: 'pod',
    status: 'invalid_mapping', value: null, points: [], message: diagnostic }];
  render(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" resourceID="pod" />);
  expect(state.panel.mock.lastCall?.[0]).toMatchObject({ kind: 'error', message: `${diagnostic.slice(0, 177)}…` });
  expect(state.parse).toHaveBeenCalledWith(expect.objectContaining({ detail: diagnostic }));
});

it('normalizes catalog errors without losing source controls', () => {
  state.catalogError = new Error('RuntimeError: {"code":"UNAVAILABLE"}');
  render(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" />);
  expect(screen.getByRole('alert').textContent).toBe('The datasource rejected this query.');
  expect(screen.getByText('Metric source')).toBeTruthy();
});
it('defaults to owner-declared favorites and keeps additional metrics inside a searchable picker', async () => {
  state.useDefaults = true;
  state.extraMetrics = Array.from({ length: 23 }, (_, index) => ({
    id: `extra-${index}`, name: `Additional metric ${index}`, unit: 'bytes', shapes: ['range'], description: '',
  }));
  render(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" defaultMetricIDs={['cpu', 'unavailable-default']} />);
  expect(state.defaults.mock.lastCall?.[0]).toEqual({ metric_ids: ['cpu'] });
  expect(screen.getByRole('button', { name: 'Remove CPU' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Additional metric 22' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add metric' }));
  fireEvent.change(await screen.findByLabelText('Search metrics'), { target: { value: 'Additional metric 22' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Additional metric 22' }));
  const patch = state.update.mock.lastCall?.[0];
  expect(patch({ metric_ids: ['cpu'] })).toEqual({ metric_ids: ['cpu', 'extra-22'] });
});

it('retains saved unavailable metric IDs instead of pruning them against the catalog', () => {
  state.selectedIDs = ['cpu', 'saved-unavailable'];
  render(<ResourceMetricPanels connectionID="cluster" resourceKey="k8s:/pods" />);
  expect(screen.getByRole('button', { name: 'Remove saved-unavailable' })).toBeTruthy();
  expect(state.update).not.toHaveBeenCalled();
});
