import { useResources } from '@omniviewdev/runtime';
import { Select } from '@omniviewdev/ui/inputs';
import type { Namespace } from 'kubernetes-types/core/v1';
import React from 'react';

const selectSx = {
  minWidth: 160,
  maxWidth: 280,
  '& .MuiSelect-select': {
    py: '2px !important',
  },
} as const;

type Props = {
  /** The active connection being used */
  connectionID: string;

  /** The currently selected namespaces. */
  selected: string[];

  /** Set the selected namespaces. */
  setNamespaces: (namespaces: string[]) => void;
};

/**
 * Renders a select for choosing namespaces.
 * Uses useResources to subscribe to namespace watch events for live updates.
 */
const NamespaceSelect: React.FC<Props> = ({ connectionID, selected, setNamespaces }) => {
  const { resources } = useResources({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'core::v1::Namespace',
    idAccessor: 'metadata.name',
  });

  const namespaceNames = React.useMemo(() => {
    const items = (resources.data?.result ?? []) as Namespace[];
    return items
      .map((ns) => ns.metadata?.name)
      .filter((name): name is string => Boolean(name))
      .sort();
  }, [resources.data]);

  const handleChange = (newValue: string | string[]) => {
    setNamespaces(Array.isArray(newValue) ? newValue : [newValue]);
  };

  return (
    <Select
      size="xs"
      multiple
      searchable
      clearable
      value={selected}
      onChange={handleChange}
      placeholder="All Namespaces"
      sx={selectSx}
      options={namespaceNames.map((ns: string) => ({
        value: ns,
        label: ns,
      }))}
    />
  );
};

export default NamespaceSelect;
