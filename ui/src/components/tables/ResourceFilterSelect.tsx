import { Select } from '@omniviewdev/ui/inputs';
import React from 'react';

const selectSx = {
  minWidth: 160,
  maxWidth: 280,
  '& .MuiSelect-select': {
    py: '2px !important',
  },
} as const;

type Props = {
  /** Raw table data used to derive the set of available options. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  /** Extracts the filterable string value from a single data row. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  accessor: (row: any) => string | undefined;
  /** Currently selected filter values. */
  value: string[];
  /** Called when the selection changes. */
  onChange: (values: string[]) => void;
  /** Placeholder shown when nothing is selected (e.g. "All Nodes"). */
  placeholder: string;
};

/**
 * Generic multi-select dropdown that derives its option list from the live
 * table data via the provided accessor. Matches the same compact style as
 * NamespaceSelect so the toolbar dropdowns look uniform.
 */
const ResourceFilterSelect: React.FC<Props> = ({ data, accessor, value, onChange, placeholder }) => {
  const options = React.useMemo(() => {
    const set = new Set<string>();
    for (const row of data) {
      const v = accessor(row);
      if (v) {
        set.add(v);
      }
    }
    return [...set].sort().map((v) => ({ value: v, label: v }));
  }, [data, accessor]);

  const handleChange = (newValue: string | string[]) => {
    onChange(Array.isArray(newValue) ? newValue : [newValue]);
  };

  return (
    <Select
      size="xs"
      multiple
      searchable
      clearable
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      sx={selectSx}
      options={options}
    />
  );
};

export default ResourceFilterSelect;
