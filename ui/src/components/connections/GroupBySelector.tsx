import React from 'react';

import type { GroupByMode, ConnectionAttribute } from '../../types/clusters';

import SimpleSelect from './SimpleSelect';

type Props = {
  value: GroupByMode;
  onChange: (value: GroupByMode) => void;
  hasCustomGroups: boolean;
  availableAttributes: ConnectionAttribute[];
  availableTags: string[];
};

// Base connection attributes always shown (if they have 2+ distinct values)
const BASE_ATTRIBUTES = new Set(['kubeconfig', 'cluster', 'user']);

const selectStyle: React.CSSProperties = { inlineSize: '12em', maxInlineSize: '100%' };

const GroupBySelector: React.FC<Props> = ({
  value,
  onChange,
  hasCustomGroups,
  availableAttributes,
  availableTags,
}) => {
  const baseAttrs = availableAttributes.filter((a) => BASE_ATTRIBUTES.has(a.key));
  const cloudAttrs = availableAttributes.filter((a) => !BASE_ATTRIBUTES.has(a.key));
  const hasTags = availableTags.length > 0;

  return (
    <SimpleSelect
      size="sm"
      aria-label="Group by"
      value={value}
      onChange={(newValue) => {
        if (newValue) onChange(newValue as GroupByMode);
      }}
      style={selectStyle}
      options={[
        { value: 'none', label: 'No Grouping' },
        { value: 'favorites', label: 'Favorites' },
        { value: 'provider', label: 'Provider' },
        { value: 'status', label: 'Status' },
        ...(hasCustomGroups ? [{ value: 'custom', label: 'Custom Groups' }] : []),
        ...(hasTags ? [{ value: 'tags', label: 'Tags' }] : []),
        { value: 'recent', label: 'Recent' },
        ...baseAttrs.map((attr) => ({
          value: `label:${attr.key}`,
          label: attr.displayName,
        })),
        ...cloudAttrs.map((attr) => ({
          value: `label:${attr.key}`,
          label: attr.displayName,
        })),
      ]}
    />
  );
};

export default GroupBySelector;
