import { MultiSelect } from '@omniviewdev/base-ui';
import React from 'react';

import styles from './toolbarInputs.module.css';

type Props = {
  /**
   * Selectable values, derived from the table's complete collection. The owner keeps this array
   * for as long as its members are the same, so a status-only update does not render the list.
   */
  options: readonly string[];
  /** Currently selected filter values. */
  value: string[];
  /** Called when the selection changes. */
  onChange: (values: string[]) => void;
  /** Placeholder shown when nothing is selected (e.g. "All Nodes"). */
  placeholder: string;
};

/**
 * Generic multi-select dropdown over a ready option list. Matches the same compact style as
 * NamespaceSelect so the toolbar dropdowns look uniform.
 */
const ResourceFilterSelect: React.FC<Props> = ({ options, value, onChange, placeholder }) => (
  <MultiSelect
    size="sm"
    variant="outline"
    items={options}
    value={value}
    onValueChange={(values) => onChange(values)}
    placeholder={placeholder}
    triggerLabel={placeholder}
    maxVisibleChips={2}
    clearable
    className={styles.filterSelect}
  />
);

export default ResourceFilterSelect;
