import { IconButton, Stack } from '@omniviewdev/base-ui';
import React from 'react';
import { LuArrowUp, LuArrowDown } from 'react-icons/lu';

import type { SortByField, SortDirection, ConnectionAttribute } from '../../types/clusters';

import SimpleSelect from './SimpleSelect';

type Props = {
  sortBy: SortByField;
  sortDirection: SortDirection;
  onSortByChange: (value: SortByField) => void;
  onSortDirectionChange: (value: SortDirection) => void;
  availableAttributes: ConnectionAttribute[];
};

const selectStyle: React.CSSProperties = { inlineSize: '12em', maxInlineSize: '100%' };

const SortBySelector: React.FC<Props> = ({
  sortBy,
  sortDirection,
  onSortByChange,
  onSortDirectionChange,
  availableAttributes,
}) => {
  // Only show attributes with reasonable coverage for sorting
  const sortableAttrs = availableAttributes.filter((a) => a.coverage >= 0.1);

  return (
    <Stack direction="row" align="center" spacing={1}>
      <SimpleSelect
        size="sm"
        aria-label="Sort by"
        value={sortBy}
        onChange={(newValue) => {
          if (newValue) onSortByChange(newValue as SortByField);
        }}
        style={selectStyle}
        options={[
          { value: 'name', label: 'Name' },
          { value: 'provider', label: 'Provider' },
          { value: 'status', label: 'Status' },
          { value: 'recency', label: 'Recently Used' },
          { value: 'fact:region', label: 'Region' },
          { value: 'fact:account', label: 'Account' },
          { value: 'fact:environment', label: 'Environment' },
          { value: 'metadata', label: 'Metadata freshness' },
          ...sortableAttrs.map((attr) => ({
            value: `label:${attr.key}`,
            label: attr.displayName,
          })),
        ]}
      />
      <IconButton
        size="sm"
        variant="outline"
        color="neutral"
        aria-label={sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
        onClick={() => onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc')}
      >
        {sortDirection === 'asc' ? <LuArrowUp size={16} /> : <LuArrowDown size={16} />}
      </IconButton>
    </Stack>
  );
};

export default SortBySelector;
