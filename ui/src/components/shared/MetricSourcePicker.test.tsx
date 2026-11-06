import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ update: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@omniviewdev/runtime', () => ({
  useMetricViewSourceSelection: () => ({ selection: { mode: 'inherit' }, isLoading: false, isSaving: false,
    error: null, update: state.update }),
  useMetricOwnerConnection: () => ({ name: 'Development cluster' }),
  useMetricSourceInventory: () => ({ data: { providers: [{ pluginID: 'owner', name: 'Owner provider', icon: 'LuBox' }],
    options: [{ source: { plugin_id: 'monitor', connection_id: 'tenant', datasource_uid: 'prom', datasource_kind: 'prometheus', native: false },
      label: 'Kind monitoring · Prometheus', providerName: 'Monitoring', providerIcon: 'LuChartLine' }], failures: [] } }),
  metricSourceIdentity: (source: Record<string, unknown>) => JSON.stringify([source.plugin_id, source.connection_id,
    source.native === true, source.datasource_uid, source.datasource_kind]),
  presentMetricSource: (source: { plugin_id: string } | null | undefined,
    inventory: { options: { source: { plugin_id: string }; label: string; providerIcon: string; providerName: string }[] }) =>
    source ? inventory.options.find(option => option.source.plugin_id === source.plugin_id) ?? null : null,
  parseAppError: (error: Error) => ({ title: 'Unavailable', detail: error.message }),
}));
vi.mock('./Icon', () => ({ default: ({ name }: { name: string }) => <svg data-icon={name} aria-hidden /> }));
import MetricSourcePicker from './MetricSourcePicker';
afterEach(() => { cleanup(); state.update.mockClear(); });


it('shows admitted inherited source metadata without changing inherited selection', () => {
  render(<MetricSourcePicker ownerPluginID="owner" ownerConnectionID="cluster" resourceKey="pods"
    resolvedSource={{ plugin_id: 'monitor', connection_id: 'tenant', datasource_uid: 'prom', datasource_kind: 'prometheus', native: false }} />);
  const trigger = screen.getByRole('combobox', { name: 'Metric source' });
  expect(trigger.textContent).toContain('Kind monitoring · Prometheus');
  expect(trigger.querySelector('svg')?.getAttribute('data-icon')).toBe('LuChartLine');
  fireEvent.click(trigger);
  expect(screen.getByRole('option', { name: /Inherit defaults/ }).getAttribute('aria-selected')).toBe('true');
  expect(state.update).not.toHaveBeenCalled();
});
