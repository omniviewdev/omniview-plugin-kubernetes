import { Autocomplete, Stack, Text, type ComponentSize } from '@omniviewdev/base-ui';
import { useConnectionNamespaces } from '@omniviewdev/runtime';
import React, { useMemo } from 'react';
import { LuChevronDown } from 'react-icons/lu';

import { PLUGIN_ID } from '@/pluginId';

interface NamespaceSelectProps {
  value: string;
  onChange: (namespace: string) => void;
  connectionID: string;
  size?: ComponentSize;
  placeholder?: string;
  error?: string;
}

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, width: '100%' };
const inputStyle: React.CSSProperties = { flex: 1, minWidth: 0 };

/**
 * Kubernetes-specific namespace selector with creatable support.
 * Fetches namespaces from the connected cluster and allows entering
 * a new namespace name (Helm's --create-namespace handles creation).
 * Free text is accepted: any typed value is reported through `onChange`.
 */
export default function NamespaceSelect({
  value,
  onChange,
  connectionID,
  size = 'sm',
  placeholder = 'Select or create namespace',
  error,
}: NamespaceSelectProps) {
  const { namespaces } = useConnectionNamespaces({
    pluginID: PLUGIN_ID,
    connectionID,
  });

  const items = useMemo<string[]>(() => namespaces.data ?? [], [namespaces.data]);

  return (
    <Stack direction="column" spacing={1} style={{ width: '100%' }}>
      <Autocomplete.Root
        items={items}
        value={value}
        onValueChange={(next: string) => onChange(next)}
        size={size}
      >
        <div style={rowStyle}>
          <Autocomplete.Input
            placeholder={placeholder}
            aria-invalid={error ? true : undefined}
            style={inputStyle}
          />
          <Autocomplete.Trigger aria-label="Show namespaces">
            <LuChevronDown size={14} />
          </Autocomplete.Trigger>
        </div>
        <Autocomplete.Portal>
          <Autocomplete.Positioner sideOffset={4}>
            <Autocomplete.Popup>
              <Autocomplete.List>
                {(ns: string) => (
                  <Autocomplete.Item key={ns} value={ns}>
                    {ns}
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
              <Autocomplete.Empty>
                {namespaces.isLoading ? 'Loading namespaces…' : 'No matching namespace; it will be created'}
              </Autocomplete.Empty>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
      {error && (
        <Text size="xs" tone="danger">
          {error}
        </Text>
      )}
    </Stack>
  );
}

NamespaceSelect.displayName = 'NamespaceSelect';
