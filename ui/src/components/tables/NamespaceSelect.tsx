import { MultiSelect } from '@omniviewdev/base-ui';
import { useResources } from '@omniviewdev/runtime';
import type { Namespace } from 'kubernetes-types/core/v1';
import React from 'react';

import { PLUGIN_ID } from '@/pluginId';

import styles from './toolbarInputs.module.css';

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
    pluginID: PLUGIN_ID,
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

  return (
    <MultiSelect
      size="sm"
      variant="outline"
      items={namespaceNames}
      value={selected}
      onValueChange={(values) => setNamespaces(values)}
      placeholder="All Namespaces"
      searchPlaceholder="Search namespaces..."
      triggerLabel="Namespaces"
      maxVisibleChips={2}
      clearable
      className={styles.filterSelect}
    />
  );
};

export default NamespaceSelect;
