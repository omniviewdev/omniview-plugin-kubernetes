import { Select, Stack, Text } from '@omniviewdev/base-ui';
import { parseAppError, useMetricViewSourceSelection, type MetricSourceRef } from '@omniviewdev/runtime';
import { MetricClient } from '@omniviewdev/runtime/api';
import { useQuery } from '@tanstack/react-query';

export interface MetricSourcePickerProps {
  ownerPluginID: string;
  ownerConnectionID: string;
  resourceKey: string;
  onChange?: () => void;
  disabled?: boolean;
}

export function metricSourceIdentity(source: MetricSourceRef): string {
  return JSON.stringify([source.plugin_id, source.connection_id, source.datasource_uid, source.datasource_kind]);
}

/** Routing controls stay independent from chart and metric-selection preferences. */
export default function MetricSourcePicker(props: MetricSourcePickerProps) {
  const view = useMetricViewSourceSelection(props.ownerPluginID, props.ownerConnectionID, props.resourceKey);
  const sources = useQuery({ queryKey: ['metric', 'source-picker'], retry: false,
    queryFn: async () => {
      const providers = (await MetricClient.GetProviders()).filter(provider => provider.supports_connections);
      const discovered = await Promise.allSettled(providers.map(async provider => {
        const plugin = provider.plugin_id;
        const connections = await MetricClient.GetProviderConnections(plugin);
        return (await Promise.all(connections.map(async connection =>
          (await MetricClient.GetDataSources(plugin, connection.id)).map(datasource => ({
            source: { plugin_id: plugin, connection_id: connection.id, datasource_uid: datasource.uid, datasource_kind: datasource.kind },
            label: `${connection.name} · ${datasource.name} (${plugin})`,
          }))))).flat();
      }));
      return {
        options: discovered.flatMap(result => result.status === 'fulfilled' ? result.value : []),
        failures: discovered.flatMap(result => result.status === 'rejected' ? [parseAppError(result.reason)] : []),
      };
    },
  });
  const selected = view.selection;
  const value = selected?.mode === 'external' && selected.source ? metricSourceIdentity(selected.source) : selected?.mode ?? 'inherit';
  const items = [
    { value: 'inherit', label: 'Inherit defaults' },
    { value: 'native', label: 'Native' },
    ...(sources.data?.options ?? []).map(option => ({ value: metricSourceIdentity(option.source), label: `External · ${option.label}` })),
  ];
  if (selected?.mode === 'external' && selected.source && !items.some(item => item.value === value)) {
    items.push({ value, label: `External · unavailable (${selected.source.plugin_id}/${selected.source.connection_id}/${selected.source.datasource_uid}/${selected.source.datasource_kind})` });
  }
  const error = view.error ?? sources.error;
  const parsedError = error ? parseAppError(error) : null;
  const errorLabel = parsedError ? parsedError.detail || parsedError.title : '';
  return <Stack direction="column" spacing={1}>
    <Select.Root size="sm" value={value} items={items} disabled={props.disabled || view.isLoading || view.isSaving || !selected}
      onValueChange={next => {
        if (next === null) return;
        const option = sources.data?.options.find(item => metricSourceIdentity(item.source) === next);
        if (next !== 'inherit' && next !== 'native' && !option) return;
        void view.update(next === 'inherit' || next === 'native' ? next : 'external', option?.source)
          .then(() => props.onChange?.()).catch(() => undefined);
      }}>
      <Select.Trigger aria-label="Metric source" aria-invalid={!!error}><Select.Value /></Select.Trigger>
      <Select.Portal><Select.Positioner sideOffset={4}><Select.Popup><Select.List>
        {items.map(item => <Select.Item key={item.value} value={item.value}><Select.ItemText>{item.label}</Select.ItemText></Select.Item>)}
      </Select.List></Select.Popup></Select.Positioner></Select.Portal>
    </Select.Root>
    {parsedError && <Text size="xs" role="alert" tone="danger">{errorLabel.length > 180 ? `${errorLabel.slice(0, 177)}…` : errorLabel}</Text>}
    {!!sources.data?.failures.length && <details><summary><Text as="span" size="xs" tone="muted">{sources.data.failures.length} provider source catalogs unavailable</Text></summary>
      {sources.data.failures.map((failure, index) => <Text key={index} size="xs">{failure.code ? `${failure.code}: ` : ''}{failure.detail || failure.title}</Text>)}
    </details>}
  </Stack>;
}
