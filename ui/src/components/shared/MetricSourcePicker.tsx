import { Avatar, Collapsible, CollapsibleContent, CollapsibleTrigger, Select, Stack, Text } from '@omniviewdev/base-ui';
import { parseAppError, useMetricViewSourceSelection, useMetricSourceInventory, useMetricOwnerConnection,
  metricSourceIdentity, presentMetricSource, type MetricSourceRef } from '@omniviewdev/runtime';
import { LuChevronDown } from 'react-icons/lu';

import Icon from './Icon';

export interface MetricSourcePickerProps {
  ownerPluginID: string;
  ownerConnectionID: string;
  resourceKey: string;
  /** Admitted effective catalog source; inheritance remains the persisted selection mode. */
  resolvedSource?: Readonly<MetricSourceRef> | null;
  onChange?: () => void;
  disabled?: boolean;
}


/** Routing controls stay independent from chart and metric-selection preferences. */
export default function MetricSourcePicker(props: MetricSourcePickerProps) {
  const view = useMetricViewSourceSelection(props.ownerPluginID, props.ownerConnectionID, props.resourceKey);
  const sources = useMetricSourceInventory();
  const owner = useMetricOwnerConnection(props.ownerPluginID, props.ownerConnectionID);
  const provider = sources.data?.providers.find(item => item.pluginID === props.ownerPluginID);
  const ownerLabel = owner?.name || props.ownerConnectionID;
  const renderIcon = (icon: string, name: string) => !icon ? null : /^(https?:|data:|\/)/.test(icon)
    ? <Avatar size="sm" src={icon} alt="" name={name} />
    : <Icon name={icon} size={14} aria-hidden />;
  const selected = view.selection;
  const value = selected?.mode === 'external' && selected.source ? metricSourceIdentity(selected.source) : selected?.mode ?? 'inherit';
  const items = [
    { value: 'inherit', label: `${ownerLabel} · Inherit defaults`, icon: provider?.icon || '', providerName: provider?.name || '', description: 'Owner defaults · Native unless configured' },
    { value: 'native', label: `${ownerLabel} · Native`, icon: provider?.icon || '', providerName: provider?.name || '', description: `Owner · ${ownerLabel}` },
    ...(sources.data?.options ?? []).map(option => ({ value: metricSourceIdentity(option.source), label: option.label,
      icon: option.providerIcon, providerName: option.providerName, description: `External · ${option.providerName}` })),
  ];
  if (selected?.mode === 'external' && selected.source && !items.some(item => item.value === value)) {
    items.push({ value, label: 'External source unavailable', icon: '', providerName: selected.source.plugin_id,
      description: `${selected.source.connection_id} · ${selected.source.datasource_uid}` });
  }
  const active = items.find(item => item.value === value);
  const inherited = value === 'inherit' ? presentMetricSource(props.resolvedSource, sources.data) : null;
  const triggerIcon = inherited ? inherited.providerIcon : active?.icon || '';
  const triggerProviderName = inherited ? inherited.providerName : active?.providerName || '';
  const triggerLabel = inherited
    ? inherited.source.native ? `${ownerLabel} · Native` : inherited.label
    : active?.label;
  const error = view.error ?? sources.error;
  const parsedError = view.error ? parseAppError(view.error)
    : sources.error ? { title: 'Metric source catalogs unavailable', detail: '' } : null;
  const errorLabel = parsedError ? parsedError.detail || parsedError.title : '';
  const catalogFailures = Array.from(new Map((sources.data?.failures ?? []).map(failure =>
    [JSON.stringify([failure.pluginID, failure.message]), failure] as const)));
  return <Stack direction="column" spacing={1}>
    <Select.Root size="sm" value={value} items={items} disabled={props.disabled || view.isLoading || view.isSaving || !selected}
      onValueChange={next => {
        if (next === null) return;
        const option = sources.data?.options.find(item => metricSourceIdentity(item.source) === next);
        if (next !== 'inherit' && next !== 'native' && !option) return;
        void view.update(next === 'inherit' || next === 'native' ? next : 'external', option?.source)
          .then(() => props.onChange?.()).catch(() => undefined);
      }}>
      <Select.Trigger aria-label="Metric source" aria-invalid={!!error} startDecorator={renderIcon(triggerIcon, triggerProviderName)}>
        <Select.Value>{() => triggerLabel}</Select.Value>
        <Select.Icon><LuChevronDown /></Select.Icon>
      </Select.Trigger>
      <Select.Portal><Select.Positioner sideOffset={4}><Select.Popup><Select.List>
        {items.map(item => <Select.Item key={item.value} value={item.value} startDecorator={renderIcon(item.icon, item.providerName)}>
          <Stack direction="column" spacing={0}><Select.ItemText>{item.label}</Select.ItemText>
            <Text size="xs" tone="muted">{item.description}</Text></Stack>
        </Select.Item>)}
      </Select.List></Select.Popup></Select.Positioner></Select.Portal>
    </Select.Root>
    {parsedError && <Text size="xs" role="alert" tone="danger">{errorLabel.length > 180 ? `${errorLabel.slice(0, 177)}…` : errorLabel}</Text>}
    {!!catalogFailures.length && <Collapsible>
      <CollapsibleTrigger><Text as="span" size="xs" tone="muted">{catalogFailures.length} provider source catalogs unavailable</Text></CollapsibleTrigger>
      <CollapsibleContent>
        {catalogFailures.map(([id, failure]) => <Text key={id} size="xs">{failure.message}</Text>)}
      </CollapsibleContent>
    </Collapsible>}
  </Stack>;
}
